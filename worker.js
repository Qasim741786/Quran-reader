let cachedToken = null;
let tokenExpiresAt = 0;
const SUPPORTED_CHAPTER_RECITERS = new Set([159, 1, 9, 174]);
const CONTENT_SYNC_RESOURCE_GROUP = "recitations";

class ContentSyncError extends Error {
  constructor(stage, status = 502, qfCode = null, details = {}) {
    super(stage);
    this.stage = stage;
    this.status = status;
    this.qfCode = qfCode;
    this.details = details;
  }
}

function safeQfCode(payload) {
  const value = payload?.type || payload?.error?.code || null;
  return typeof value === "string" && /^[a-z0-9_-]{1,80}$/i.test(value) ? value : null;
}

async function getQfToken(env) {
  const now = Date.now();

  if (cachedToken && now < tokenExpiresAt - 60000) {
    return cachedToken;
  }

  const credentials = btoa(`${env.QF_CLIENT_ID}:${env.QF_CLIENT_SECRET}`);

  const response = await fetch(
    "https://oauth2.quran.foundation/oauth2/token",
    {
      method: "POST",
      headers: {
        "Authorization": `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials&scope=content",
    }
  );

  if (!response.ok) {
    const payload = await response.clone().json().catch(() => null);
    throw new ContentSyncError("oauth_token", response.status, safeQfCode(payload));
  }

  const data = await response.json();

  cachedToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in || 3600) * 1000;

  return cachedToken;
}

async function qfRequest(env, path, stage = "qf_request") {
  const token = await getQfToken(env);

  let response;
  try {
    response = await fetch(
      `https://apis.quran.foundation${path}`,
      {
        headers: {
          "x-auth-token": token,
          "x-client-id": env.QF_CLIENT_ID,
        },
      }
    );
  } catch {
    throw new ContentSyncError(stage, 502, "network_error");
  }

  if (!response.ok) {
    const payload = await response.clone().json().catch(() => null);
    throw new ContentSyncError(stage, response.status, safeQfCode(payload));
  }

  return response;
}

function validChapterAudioRequest(reciterId, chapterNumber) {
  return SUPPORTED_CHAPTER_RECITERS.has(reciterId)
    && Number.isInteger(chapterNumber)
    && chapterNumber >= 1
    && chapterNumber <= 114;
}

async function getChapterAudio(env, reciterId, chapterNumber) {
  const response = await qfRequest(
    env,
    `/content/api/v4/chapter_recitations/${reciterId}/${chapterNumber}?segments=true`
  );
  const payload = await response.json();
  const audioFile = payload?.audio_file;
  if (!audioFile?.audio_url || !/^https:\/\//i.test(audioFile.audio_url)) {
    throw new Error("Quran Foundation returned no playable chapter audio");
  }
  return audioFile;
}

function contentSyncRecordKey(record) {
  return String(record?.id ?? record?.record_key ?? "");
}

function chapterAudioRecord(records, chapterNumber) {
  return (records || []).find((record) => (
    record?.record_type === "chapter_audio_file"
    && Number(record.chapter_id) === chapterNumber
    && /^https:\/\//i.test(record.audio_url || "")
  )) || null;
}

function canonicalLabel(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\[[^\]]*\]|\([^)]*\)/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();
}

function recordLabels(record, fields) {
  return fields.flatMap((field) => {
    const value = field.split(".").reduce((current, key) => current?.[key], record);
    const label = canonicalLabel(value);
    return label ? [label] : [];
  });
}

function matchingRecitationResource(chapterReciter, recitations) {
  const chapterLabels = new Set(recordLabels(chapterReciter, ["name", "translated_name.name"]));
  const chapterStyle = canonicalLabel(chapterReciter?.style?.name || chapterReciter?.style?.translated_name?.name);
  const candidates = (recitations || []).filter((recitation) => {
    const recitationLabels = recordLabels(recitation, ["reciter_name", "translated_name.name"]);
    const hasNameMatch = recitationLabels.some((label) => chapterLabels.has(label));
    const recitationStyle = canonicalLabel(recitation?.style);
    return hasNameMatch && (!chapterStyle || !recitationStyle || chapterStyle === recitationStyle);
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function contentSyncPath(path) {
  // Content Sync returns relative `/api/v4/...` paths. qfRequest addresses the
  // API gateway root, so add `/content` before forwarding them upstream.
  if (path.startsWith("/api/v4/resources/")) return `/content${path}`;
  if (!path.startsWith("/content/api/v4/resources/")) {
    throw new Error("Unexpected Content Sync path");
  }
  return path;
}

async function getContentSyncSnapshot(env, resourceId) {
  const response = await qfRequest(
    env,
    `/content/api/v4/resources/snapshots/${CONTENT_SYNC_RESOURCE_GROUP}/${resourceId}`,
    "content_sync.snapshot",
  );
  return response.json();
}

async function syncContentResource(env, resourceId, syncToken, reciterId, chapterNumber, previousRecordKey) {
  const params = new URLSearchParams({
    resources: `${CONTENT_SYNC_RESOURCE_GROUP}:${resourceId}`,
    per_page: "100",
  });
  if (syncToken) params.set("sync_token", syncToken);
  else params.set("bootstrap", "true");

  let nextPath = `/content/api/v4/resources/sync?${params}`;
  let finalToken = null;
  let currentRecord = null;
  let resourceDeleted = false;
  let relevantRowChanged = false;

  while (nextPath) {
    const response = await qfRequest(env, contentSyncPath(nextPath), syncToken ? "content_sync.incremental" : "content_sync.bootstrap");
    const payload = await response.json();
    const sync = payload?.sync;
    if (!sync || !Array.isArray(sync.mutations)) throw new Error("Invalid Content Sync response");

    const mutations = [...sync.mutations].sort((a, b) => Number(a.sequence) - Number(b.sequence));
    for (const mutation of mutations) {
      if (Number(mutation.resource_id) !== resourceId || mutation.resource_group !== CONTENT_SYNC_RESOURCE_GROUP) continue;

      if (mutation.type === "RESOURCE_DELETE") {
        resourceDeleted = true;
        currentRecord = null;
        continue;
      }

      if (mutation.type === "RESOURCE_CREATE" || mutation.type === "RESOURCE_INVALIDATE") {
        if (!mutation.snapshot_url) throw new Error("Content Sync change has no snapshot");
        const snapshotResponse = await qfRequest(env, contentSyncPath(mutation.snapshot_url), "content_sync.snapshot");
        const snapshot = await snapshotResponse.json();
        currentRecord = chapterAudioRecord(snapshot?.records, chapterNumber);
        resourceDeleted = false;
        relevantRowChanged = true;
        continue;
      }

      if (mutation.record_type !== "chapter_audio_file") continue;
      const recordKey = String(mutation.record_key ?? mutation.data?.id ?? "");
      const isCurrentTrack = Number(mutation.data?.chapter_id) === chapterNumber;
      const isKnownTrack = Boolean(previousRecordKey) && recordKey === String(previousRecordKey);

      if (mutation.type === "ROW_DELETE" && isKnownTrack) {
        currentRecord = null;
        relevantRowChanged = true;
      } else if ((mutation.type === "ROW_CREATE" || mutation.type === "ROW_UPDATE") && isCurrentTrack) {
        currentRecord = mutation.data;
        relevantRowChanged = true;
      }
    }

    if (!sync.has_more) {
      finalToken = sync.next_sync_token || null;
      break;
    }
    if (!sync.next_page_url) throw new Error("Content Sync pagination is incomplete");
    nextPath = contentSyncPath(sync.next_page_url);
  }

  if (resourceDeleted) return { action: "delete", sync_token: finalToken };
  if (!currentRecord && !syncToken) {
    const snapshot = await getContentSyncSnapshot(env, resourceId);
    currentRecord = chapterAudioRecord(snapshot?.records, chapterNumber);
  }
  if (!currentRecord && relevantRowChanged) return { action: "delete", sync_token: finalToken };

  const recordKey = currentRecord ? contentSyncRecordKey(currentRecord) : String(previousRecordKey || "");
  return {
    action: relevantRowChanged || (previousRecordKey && recordKey !== String(previousRecordKey)) ? "replace" : "unchanged",
    sync_token: finalToken,
    record_key: recordKey || null,
  };
}

async function discoverContentSyncResource(env, reciterId) {
  // QF documents chapter-reciter and recitation resource IDs as separate ID
  // spaces. Resolve the canonical Content Sync resource using the official
  // reciter metadata (name + style), then bootstrap only that resource.
  const [chapterResponse, recitationResponse] = await Promise.all([
    qfRequest(env, "/content/api/v4/resources/chapter_reciters", "content_sync.chapter_reciters"),
    qfRequest(env, "/content/api/v4/resources/recitations", "content_sync.recitations"),
  ]);
  const chapterPayload = await chapterResponse.json();
  const recitationPayload = await recitationResponse.json();
  const chapterReciter = (chapterPayload?.reciters || []).find((candidate) => Number(candidate.id) === reciterId);
  const resource = matchingRecitationResource(chapterReciter, recitationPayload?.recitations);
  if (resource && Number.isInteger(Number(resource.id)) && Number(resource.id) > 0) return Number(resource.id);
  throw new ContentSyncError("content_sync.discovery.no_matching_resource", 404, null, {
    matched_chapter_reciter_id: reciterId,
    matching_resource_found: false,
    chapter_audio_file_found: false,
  });
}

async function contentSyncValidation(env, reciterId, chapterNumber, state = {}) {
  const suppliedResourceId = Number(state.resource_id);
  const resourceId = Number.isInteger(suppliedResourceId) && suppliedResourceId > 0
    ? suppliedResourceId
    : await discoverContentSyncResource(env, reciterId);
  const result = await syncContentResource(
    env,
    resourceId,
    typeof state.sync_token === "string" ? state.sync_token : "",
    reciterId,
    chapterNumber,
    state.record_key,
  );
  return {
    ...result,
    resource_id: resourceId,
    validated_at: new Date().toISOString(),
  };
}

function publicAudioMetadata(requestUrl, reciterId, chapterNumber, audioFile) {
  return {
    reciter_id: reciterId,
    chapter_number: chapterNumber,
    audio_url: `${requestUrl.origin}/api/qf/chapter-audio/${reciterId}/${chapterNumber}/file`,
    format: audioFile.format || "mp3",
    file_size: audioFile.file_size ?? null,
    // The app uses these official timings when present and retains its bundled
    // timings only as a safe fallback if this metadata request fails.
    timestamps: Array.isArray(audioFile.timestamps) ? audioFile.timestamps : [],
  };
}

function apiHeaders(initial = {}) {
  const headers = new Headers(initial);
  // The bundled Capacitor app is served from capacitor://localhost. No
  // credentials are accepted from clients, so this public audio metadata can
  // safely be read by the native WebView as well as the same-origin PWA.
  headers.set("Access-Control-Allow-Origin", "*");
  return headers;
}

function safeApiError(message, status = 502) {
  return Response.json({ error: message }, {
    status,
    headers: apiHeaders({ "Cache-Control": "no-store" }),
  });
}

function safeContentSyncError(error, exposeDiagnostics = false, message = "Recitation sync is temporarily unavailable") {
  const diagnostic = error instanceof ContentSyncError
    ? {
      stage: error.stage,
      http_status: error.status,
      qf_error_code: error.qfCode,
      matched_chapter_reciter_id: Number.isInteger(error.details?.matched_chapter_reciter_id)
        ? error.details.matched_chapter_reciter_id
        : null,
      matching_resource_found: Boolean(error.details?.matching_resource_found),
      chapter_audio_file_found: Boolean(error.details?.chapter_audio_file_found),
    }
    : {
      stage: "content_sync.unexpected",
      http_status: 502,
      qf_error_code: null,
      matching_resource_found: false,
      chapter_audio_file_found: false,
    };
  const body = { error: message };
  if (exposeDiagnostics) body.diagnostic = diagnostic;
  return Response.json(body, {
    status: diagnostic.http_status >= 400 && diagnostic.http_status < 600 ? diagnostic.http_status : 502,
    headers: apiHeaders({ "Cache-Control": "no-store" }),
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/qf/")) {
      return new Response(null, {
        headers: apiHeaders({
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        }),
      });
    }

    if (url.pathname === "/api/qf/chapter-reciters") {
      try {
        const response = await qfRequest(
          env,
          "/content/api/v4/resources/chapter_reciters"
        );

        return new Response(response.body, {
          status: response.status,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=3600",
            "Access-Control-Allow-Origin": "*",
          },
        });
      } catch (error) {
        return safeApiError("Unable to load reciters");
      }
    }

    const contentSyncMatch = url.pathname.match(/^\/api\/qf\/content-sync\/validate\/(\d+)\/(\d+)$/);
    if (contentSyncMatch && request.method === "POST") {
      const reciterId = Number(contentSyncMatch[1]);
      const chapterNumber = Number(contentSyncMatch[2]);
      const exposeDiagnostics = url.searchParams.get("diagnostics") === "1";
      if (!validChapterAudioRequest(reciterId, chapterNumber)) return safeApiError("Requested recitation is unavailable", 404);
      try {
        const body = await request.json().catch(() => ({}));
        const validation = await contentSyncValidation(env, reciterId, chapterNumber, body?.state || {});
        if (exposeDiagnostics) {
          return Response.json({
            diagnostic: {
              stage: "content_sync.complete",
              http_status: 200,
              qf_error_code: null,
              matched_chapter_reciter_id: reciterId,
              matching_resource_found: true,
              chapter_audio_file_found: Boolean(validation.record_key),
            },
          }, { headers: apiHeaders({ "Cache-Control": "no-store" }) });
        }
        return Response.json(validation, { headers: apiHeaders({ "Cache-Control": "no-store" }) });
      } catch (error) {
        return safeContentSyncError(error, exposeDiagnostics);
      }
    }

    const contentSyncAudioMatch = url.pathname.match(/^\/api\/qf\/content-sync\/audio\/(\d+)\/(\d+)$/);
    if (contentSyncAudioMatch) {
      const reciterId = Number(contentSyncAudioMatch[1]);
      const chapterNumber = Number(contentSyncAudioMatch[2]);
      const resourceId = Number(url.searchParams.get("resource_id"));
      if (!validChapterAudioRequest(reciterId, chapterNumber) || !Number.isInteger(resourceId) || resourceId <= 0) {
        return safeApiError("Requested recitation is unavailable", 404);
      }
      try {
        const expectedResourceId = await discoverContentSyncResource(env, reciterId);
        if (resourceId !== expectedResourceId) {
          return safeContentSyncError(new ContentSyncError("content_sync.snapshot.unexpected_resource", 404, null, {
            matched_chapter_reciter_id: reciterId,
            matching_resource_found: true,
            chapter_audio_file_found: false,
          }), url.searchParams.get("diagnostics") === "1", "Recitation audio is temporarily unavailable");
        }
        const snapshot = await getContentSyncSnapshot(env, resourceId);
        const record = chapterAudioRecord(snapshot?.records, chapterNumber);
        if (!record) {
          return safeContentSyncError(new ContentSyncError("content_sync.snapshot.chapter_audio_not_found", 404, null, {
            matched_chapter_reciter_id: reciterId,
            matching_resource_found: true,
            chapter_audio_file_found: false,
          }), url.searchParams.get("diagnostics") === "1", "Recitation audio is temporarily unavailable");
        }
        const upstreamHeaders = new Headers();
        const range = request.headers.get("Range");
        if (range) upstreamHeaders.set("Range", range);
        const upstream = await fetch(record.audio_url, { headers: upstreamHeaders });
        if (!upstream.ok && upstream.status !== 206) throw new Error("Content Sync audio file could not be loaded");
        const headers = apiHeaders({ "Cache-Control": "no-store" });
        for (const name of ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified"]) {
          const value = upstream.headers.get(name);
          if (value) headers.set(name, value);
        }
        return new Response(upstream.body, { status: upstream.status, headers });
      } catch (error) {
        return safeContentSyncError(error, url.searchParams.get("diagnostics") === "1", "Recitation audio is temporarily unavailable");
      }
    }

    const chapterAudioMatch = url.pathname.match(
      /^\/api\/qf\/chapter-audio\/(\d+)\/(\d+)(\/file)?$/
    );
    if (chapterAudioMatch) {
      const reciterId = Number(chapterAudioMatch[1]);
      const chapterNumber = Number(chapterAudioMatch[2]);
      const wantsFile = Boolean(chapterAudioMatch[3]);
      if (!validChapterAudioRequest(reciterId, chapterNumber)) {
        return safeApiError("Requested recitation is unavailable", 404);
      }

      try {
        const audioFile = await getChapterAudio(env, reciterId, chapterNumber);
        if (!wantsFile) {
          return Response.json(
            publicAudioMetadata(url, reciterId, chapterNumber, audioFile),
            { headers: apiHeaders({ "Cache-Control": "public, max-age=3600" }) }
          );
        }

        // Keep the client on this Worker route. The upstream Quran.Foundation
        // audio URL is never sent to the browser or native WebView.
        const upstreamHeaders = new Headers();
        const range = request.headers.get("Range");
        if (range) upstreamHeaders.set("Range", range);
        const upstream = await fetch(audioFile.audio_url, { headers: upstreamHeaders });
        if (!upstream.ok && upstream.status !== 206) {
          throw new Error("Quran Foundation audio file could not be loaded");
        }
        const headers = apiHeaders();
        for (const name of ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified"]) {
          const value = upstream.headers.get(name);
          if (value) headers.set(name, value);
        }
        headers.set("Cache-Control", "public, max-age=86400");
        return new Response(upstream.body, { status: upstream.status, headers });
      } catch (error) {
        return safeApiError(wantsFile ? "Recitation audio is temporarily unavailable" : "Recitation details are temporarily unavailable");
      }
    }

    return env.ASSETS.fetch(request);
  },
};
