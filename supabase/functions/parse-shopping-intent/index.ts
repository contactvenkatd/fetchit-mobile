const XAI_CHAT_COMPLETIONS_URL = "https://api.x.ai/v1/chat/completions";
const GROK_MODEL = "grok-4.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const failure = (code: string, message: string, status: number) =>
  json({ error: { code, message } }, status);

interface ShoppingIntent {
  productQuery: string;
  size: string | null;
  color: string | null;
  priceCeiling: number | null;
  quantity: number;
  retailerPreference: string | null;
}

type GrokResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  error?: { message?: string };
};

const shoppingIntentTool = {
  type: "function",
  function: {
    name: "search_products",
    description: "Extract the product search constraints from a shopping request.",
    parameters: {
      type: "object",
      properties: {
        productQuery: {
          type: "string",
          description: "Product name or concise search phrase.",
        },
        size: {
          type: ["string", "null"],
          description: "Requested size, including its unit when given.",
        },
        color: { type: ["string", "null"], description: "Requested color." },
        priceCeiling: {
          type: ["number", "null"],
          description: "Maximum price in USD, without a currency symbol.",
        },
        quantity: {
          type: "integer",
          minimum: 1,
          description: "Number requested; default to 1.",
        },
        retailerPreference: {
          type: ["string", "null"],
          description: "Preferred retailer, or null when none is stated.",
        },
      },
      required: [
        "productQuery",
        "size",
        "color",
        "priceCeiling",
        "quantity",
        "retailerPreference",
      ],
      additionalProperties: false,
    },
  },
} as const;

function isShoppingIntent(value: unknown): value is ShoppingIntent {
  if (!value || typeof value !== "object") return false;
  const intent = value as Record<string, unknown>;
  return (
    typeof intent.productQuery === "string" &&
    intent.productQuery.trim().length > 0 &&
    (intent.size === null || typeof intent.size === "string") &&
    (intent.color === null || typeof intent.color === "string") &&
    (intent.priceCeiling === null ||
      (typeof intent.priceCeiling === "number" && Number.isFinite(intent.priceCeiling))) &&
    Number.isInteger(intent.quantity) &&
    (intent.quantity as number) >= 1 &&
    (intent.retailerPreference === null || typeof intent.retailerPreference === "string")
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return failure("method_not_allowed", "Only POST requests are supported.", 405);
  }

  let body: { message?: unknown };
  try {
    body = await req.json();
  } catch {
    return failure("invalid_json", "The request body must be valid JSON.", 400);
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return failure("invalid_message", "A message is required.", 400);
  }
  if (message.length > 2000) {
    return failure("message_too_long", "The shopping request is too long.", 400);
  }

  const apiKey = Deno.env.get("XAI_API_KEY")?.trim();
  if (!apiKey) {
    return failure("service_not_configured", "Shopping intent service is not configured.", 503);
  }

  try {
    const response = await fetch(XAI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GROK_MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are FetchIt, a helpful assistant that can answer general questions and also " +
              "help find and buy products. If the user is explicitly asking to find, search for, " +
              "or buy a product, call search_products with the extracted details. Otherwise, " +
              "including when they ask for general advice or recommendations, respond naturally " +
              "and conversationally. Extract only explicit shopping constraints and use null when " +
              "a shopping constraint is unspecified.",
          },
          { role: "user", content: message },
        ],
        tools: [shoppingIntentTool],
        parallel_tool_calls: false,
        temperature: 0,
      }),
    });

    const raw = (await response.json()) as GrokResponse;
    if (!response.ok) {
      return failure(
        "xai_request_failed",
        raw.error?.message ?? `xAI returned HTTP ${response.status}.`,
        502,
      );
    }

    const responseMessage = raw.choices?.[0]?.message;
    const toolCall = responseMessage?.tool_calls?.find(
      (call) => call.function?.name === "search_products",
    );
    if (toolCall) {
      if (!toolCall.function?.arguments) {
        return failure("missing_tool_arguments", "Grok returned an incomplete shopping intent.", 502);
      }

      const intent: unknown = JSON.parse(toolCall.function.arguments);
      if (!isShoppingIntent(intent)) {
        return failure("malformed_intent", "Grok returned a malformed shopping intent.", 502);
      }

      return json({
        type: "shopping_intent",
        intent: { ...intent, productQuery: intent.productQuery.trim() },
      });
    }

    const text = responseMessage?.content?.trim();
    if (!text) {
      return failure("empty_response", "Grok did not return a response.", 502);
    }

    return json({ type: "message", text });
  } catch {
    return failure("chat_request_failed", "The assistant request failed.", 502);
  }
});
