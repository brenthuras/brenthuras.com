// netlify/functions/subscribe.js
//
// Receives a name and email from the opt-in form and adds them to the
// EmailOctopus list. Keeps the API key server-side only.

const TAG = "brenthuras.com";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let email, firstName;
  try {
    const body = JSON.parse(event.body);
    email = (body.email || "").trim().toLowerCase();
    firstName = (body.firstName || "").trim();
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body" }) };
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

  const contactPayload = { email_address: email, status: "subscribed", tags: [TAG] };
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
