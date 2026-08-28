let cachedToken = null;
let tokenExpiresAt = 0;
const SUPPORTED_CHAPTER_RECITERS = new Set([159, 1, 9]);

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
    throw new Error(`Quran Foundation authentication failed: ${response.status}`);
  }

  const data = await response.json();

  cachedToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in || 3600) * 1000;

  return cachedToken;
}

async function qfRequest(env, path) {
  const token = await getQfToken(env);

  const response = await fetch(
    `https://apis.quran.foundation${path}`,
    {
      headers: {
        "x-auth-token": token,
        "x-client-id": env.QF_CLIENT_ID,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Quran Foundation API failed: ${response.status}`);
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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
