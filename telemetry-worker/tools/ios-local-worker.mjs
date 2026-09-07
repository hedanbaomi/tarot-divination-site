// Local fixture entrypoint only. Wrangler treats Analytics Engine bindings as
// remote-connected even in local mode, so the loopback fixture injects this
// in-memory sink instead. Production continues to use src/index.js directly.
import worker from "../src/index.js";

const eventCounts = {
  install_seen: 0,
  app_active: 0,
  reading_completed: 0
};
const readingCompleted = {
  tarot: 0,
  mystagogus: 0,
  lxxxi: 0,
  card_count_sum: 0
};

const localAnalytics = {
  writeDataPoint(point) {
    // The unit suite verifies exact positional mapping. This local-only sink
    // also retains bounded aggregate counters for cross-process integration
    // evidence. It never retains the install hash/index or request metadata.
    if (point?.blobs?.[8] !== "ios") return;
    const event = point.blobs[0];
    if (Object.hasOwn(eventCounts, event)) eventCounts[event] += 1;
    if (event === "reading_completed") {
      const deck = point.blobs[2];
      if (Object.hasOwn(readingCompleted, deck)) readingCompleted[deck] += 1;
      readingCompleted.card_count_sum += Number(point.doubles?.[0]) || 0;
    }
  }
};

function withLocalAnalytics(env) {
  return { ...env, TELEMETRY: localAnalytics };
}

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    if (url.pathname === "/__fixture-internal/stats") {
      return fixtureStats(request, env);
    }
    return worker.fetch(request, withLocalAnalytics(env), context);
  },

  scheduled(event, env, context) {
    return worker.scheduled(event, withLocalAnalytics(env), context);
  }
};

async function fixtureStats(request, env) {
  if (request.method !== "GET") {
    return fixtureJson({ error: "method_not_allowed" }, 405);
  }
  if (!env.ADMIN_TOKEN || request.headers.get("authorization") !== `Bearer ${env.ADMIN_TOKEN}`) {
    return fixtureJson({ error: "unauthorized" }, 401);
  }

  const aggregate = await env.DB.prepare(`
    SELECT
      COUNT(*) AS rows,
      MIN(version_code) AS min_version_code,
      MAX(version_code) AS max_version_code,
      MIN(app_version) AS min_app_version,
      MAX(app_version) AS max_app_version,
      MIN(ios_major) AS min_ios_major,
      MAX(ios_major) AS max_ios_major
    FROM install_state
    WHERE platform = 'ios'
  `).first();
  const rows = Number(aggregate?.rows) || 0;
  const singleBuild = rows > 0 && aggregate.min_version_code === aggregate.max_version_code;
  const singleVersion = rows > 0 && aggregate.min_app_version === aggregate.max_app_version;
  const singleMajor = rows > 0 && aggregate.min_ios_major === aggregate.max_ios_major;

  return fixtureJson({
    events: { ...eventCounts },
    reading_completed: { ...readingCompleted },
    install_state: {
      platform: "ios",
      rows,
      version_code: singleBuild ? Number(aggregate.min_version_code) : null,
      app_version: singleVersion ? aggregate.min_app_version : null,
      ios_major: singleMajor ? Number(aggregate.min_ios_major) : null
    }
  });
}

function fixtureJson(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
