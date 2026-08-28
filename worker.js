let cachedToken = null;
let tokenExpiresAt = 0;

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
          },
        });
      } catch (error) {
        return Response.json(
          { error: "Unable to load reciters" },
          { status: 500 }
        );
      }
    }

    return env.ASSETS.fetch(request);
  },
};
