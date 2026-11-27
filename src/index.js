const FILTER_TERM = "расписание";
const IMAGE_WIDTH = 1440;
const CAPTION_LIMIT = 1024;
const ALERT_LIMIT = 4096;

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      run(env).catch(async (error) => {
        console.error("cron failed:", message(error));
        await alert(env, "cron failed", message(error));
      }),
    );
  },
};

async function run(env) {
  const posts = await fetchPosts(env);
  const known = await knownPosts(env);

  // First run: record the current posts so old schedules are not replayed.
  if (known.size === 0) {
    await remember(env, posts);
    console.log(`baseline: ${posts.length} posts`);
    return;
  }

  const failures = [];

  for (const post of posts) {
    if (known.has(post.key) || !matches(post)) {
      continue;
    }

    await remember(env, [post]);
    try {
      const messageId = await sendTelegram(env, post);
      console.log(`sent ${post.key} as ${messageId}`);
    } catch (error) {
      await forget(env, post.key);
      failures.push(`${post.key}: ${message(error)}`);
      console.error(`send failed ${post.key}:`, message(error));
    }
  }

  // One warning per run, so a batch of failed posts is still one message.
  if (failures.length > 0) {
    const count = failures.length;
    await alert(
      env,
      count === 1 ? "1 post failed to send" : `${count} posts failed to send`,
      failures.join("\n"),
    );
  }
}

function matches(post) {
  const [image] = post.attachments;
  return (
    post.attachments.length === 1 &&
    image.kind === "PHOTO" &&
    Boolean(image.url) &&
    post.text.toLowerCase().includes(FILTER_TERM)
  );
}

async function knownPosts(env) {
  const { results } = await env.DB.prepare("SELECT post_key FROM relayed").all();
  return new Set(results.map((row) => row.post_key));
}

async function remember(env, posts) {
  if (posts.length === 0) {
    return;
  }

  await env.DB.batch(
    posts.map((post) =>
      env.DB.prepare(
        "INSERT OR IGNORE INTO relayed (post_key, created_at) VALUES (?, ?)",
      ).bind(post.key, post.createdAt),
    ),
  );
}

async function forget(env, key) {
  await env.DB.prepare("DELETE FROM relayed WHERE post_key = ?").bind(key).run();
}

async function fetchPosts(env) {
  const channel = (env.MAX_CHANNEL_URL || "").replace(/\/+$/, "");
  if (!channel) {
    throw new Error("MAX_CHANNEL_URL is missing");
  }

  const response = await fetch(`${channel}/__data.json`, {
    headers: {
      accept: "application/json",
      "user-agent": "max-schedule-relay/1.0",
    },
    cf: { cacheTtl: 0 },
  });

  if (!response.ok) {
    throw new Error(`MAX returned HTTP ${response.status}`);
  }

  return extractPosts(await response.json()).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}

function extractPosts(payload) {
  const nodes = Array.isArray(payload?.nodes) ? payload.nodes : [];
  const data = nodes.find((node) => Array.isArray(node?.data))?.data;
  if (!data) {
    throw new Error("unexpected MAX data shape");
  }

  const root = resolve(data, 0);
  const linkInfo = resolve(data, root?.linkInfo);

  return list(resolve(data, linkInfo?.posts))
    .map((post) => decodePost(data, post))
    .filter(Boolean);
}

function decodePost(data, value) {
  const post = resolve(data, value);
  if (!post || typeof post !== "object") {
    return null;
  }

  const text = string(resolve(data, post.text));
  const link = string(resolve(data, post.link));
  const createdAt = string(resolve(data, post.createdAt));
  const attachments = list(resolve(data, post.attachment))
    .map((attachment) => resolve(data, attachment))
    .filter((attachment) => attachment && typeof attachment === "object")
    .map((attachment) => ({
      kind: string(resolve(data, attachment.attachmentType)),
      url: string(resolve(data, attachment.url)),
    }));

  return {
    key: link || `${createdAt}:${text.slice(0, 80)}`,
    text,
    createdAt,
    attachments,
  };
}

// Resolve SvelteKit's devalue flat format: in-range integers are references,
// larger/negative integers and all other values are literals.
function resolve(data, value) {
  const seen = new Set();

  while (Number.isInteger(value)) {
    if (value < 0) {
      return null;
    }
    if (value >= data.length) {
      return value;
    }
    if (seen.has(value)) {
      return null;
    }
    seen.add(value);
    value = data[value];
  }

  return value;
}

function list(value) {
  if (value === null || value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

async function sendTelegram(env, post) {
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!chatId) {
    throw new Error("TELEGRAM_CHAT_ID is missing");
  }

  const imageUrl = new URL(post.attachments[0].url);
  imageUrl.searchParams.set("fn", `w_${IMAGE_WIDTH}`);
  assertAllowedImageUrl(imageUrl);

  const response = await fetch(imageUrl, {
    headers: { accept: "image/*", "user-agent": "Mozilla/5.0" },
  });
  if (!response.ok) {
    throw new Error(`image returned HTTP ${response.status}`);
  }

  const type = response.headers.get("content-type") || "image/webp";
  const extension = type.split("/")[1]?.split(";")[0] || "webp";
  const blob = new Blob([await response.arrayBuffer()], { type });

  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("photo", blob, `schedule.${extension}`);
  if (post.text) {
    form.append("caption", post.text.slice(0, CAPTION_LIMIT));
  }

  const result = await callTelegram(env, "sendPhoto", form);
  return result.message_id;
}

// Warns the operator about a failed run. Alerting problems are logged only, so
// they never mask the failure they are reporting.
async function alert(env, summary, detail) {
  const userId = env.TELEGRAM_ALERT_USER_ID;
  if (!userId) {
    console.error("alert skipped: TELEGRAM_ALERT_USER_ID is missing");
    return;
  }

  const form = new FormData();
  form.append("chat_id", String(userId));
  form.append(
    "text",
    `max-schedule-relay: ${summary}\n\n${detail}`.slice(0, ALERT_LIMIT),
  );

  try {
    await callTelegram(env, "sendMessage", form);
  } catch (error) {
    console.error("alert failed:", message(error));
  }
}

async function callTelegram(env, method, body) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is missing");
  }

  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    { method: "POST", body },
  );
  const result = await response.json();

  if (!result.ok) {
    throw new Error(
      `Telegram ${result.error_code || "error"}: ${result.description || "unknown"}`,
    );
  }

  return result.result;
}

function assertAllowedImageUrl(url) {
  const host = url.hostname.toLowerCase();
  const allowed = ["oneme.ru", "okcdn.ru", "max.ru"].some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );

  if (!allowed) {
    throw new Error(`unexpected image host: ${host}`);
  }
}

function string(value) {
  return typeof value === "string" ? value : "";
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}
