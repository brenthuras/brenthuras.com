// netlify/functions/subscribe.js
//
// Receives a name and email from the opt-in form and adds them to the
// EmailOctopus list. Keeps the API key server-side only.
//
// Bot protection: a hidden honeypot field plus a Cloudflare Turnstile
// token that is verified here, on the server, before anything is created.

const TAG = "brenthuras.com";
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let email, firstName, website, turnstileToken;
  try {
    const body = JSON.parse(event.body);
    email = (body.email || "").trim().toLowerCase();
    firstName = (body.firstName || "").trim();
    website = (body.website || "").trim();
    turnstileToken = (body.turnstileToken || "").trim();
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body" }) };
  }

  if (website) {
    // Honeypot filled in: almost certainly a bot. Pretend it worked.
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  }

  // Turnstile: verify the token with Cloudflare before doing anything else.
  const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;
  if (!turnstileSecret) {
    console.error("TURNSTILE_SECRET_KEY is not set");
    return { statusCode: 500, body: JSON.stringify({ error: "Server configuration error" }) };
  }
  if (!turnstileToken) {
    return { statusCode: 400, body: JSON.stringify({ error: "Verification failed. Please try again." }) };
  }

  try {
    const verifyParams = new URLSearchParams({ secret: turnstileSecret, response: turnstileToken });
    const clientIp = event.headers && event.headers["x-nf-client-connection-ip"];
    if (clientIp) verifyParams.set("remoteip", clientIp);

    const verifyResponse = await fetch(TURNSTILE_VERIFY_URL, { method: "POST", body: verifyParams });
    const verifyData = await verifyResponse.json();
    if (!verifyData.success) {
      console.error("Turnstile rejected token:", verifyData["error-codes"]);
      return { statusCode: 400, body: JSON.stringify({ error: "Verification failed. Please try again." }) };
    }
  } catch (err) {
    console.error("Turnstile verification error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Could not subscribe right now" }) };
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailPattern.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: "Please enter a valid email address" }) };
  }

  const apiKey = process.env.SECRET_EMAILOCTOPUS_KEY;
  const listId = process.env.EMAILOCTOPUS_LIST_ID;
  if (!apiKey || !listId) {
    console.error("SECRET_EMAILOCTOPUS_KEY or EMAILOCTOPUS_LIST_ID is not set");
    return { statusCode: 500, body: JSON.stringify({ error: "Server configuration error" }) };
  }

  const contactPayload = { email_address: email, status: "pending", tags: [TAG] };
  if (firstName) contactPayload.fields = { FirstName: firstName };

  try {
    const response = await fetch(
      `https://api.emailoctopus.com/lists/${listId}/contacts`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(contactPayload),
      }
    );

    if (response.ok) {
      return { statusCode: 200, body: JSON.stringify({ success: true }) };
    }

    // EmailOctopus API v2 returns 409 when the contact is already on the list.
    if (response.status === 409) {
      return { statusCode: 200, body: JSON.stringify({ success: true, alreadySubscribed: true }) };
    }

    const data = await response.json().catch(() => ({}));
    console.error("EmailOctopus error:", response.status, data);
    return { statusCode: 502, body: JSON.stringify({ error: "Could not subscribe right now" }) };
  } catch (err) {
    console.error("Subscribe function error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Could not subscribe right now" }) };
  }
};
