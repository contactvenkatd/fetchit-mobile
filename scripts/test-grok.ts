const XAI_CHAT_COMPLETIONS_URL = 'https://api.x.ai/v1/chat/completions';
const GROK_MODEL = 'grok-4.3';

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
      tool_calls?: Array<{
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  error?: { message?: string };
};

const shoppingIntentTool = {
  type: 'function',
  function: {
    name: 'search_products',
    description: 'Extract the product search constraints from a shopping request.',
    parameters: {
      type: 'object',
      properties: {
        productQuery: { type: 'string', description: 'Product name or concise search phrase.' },
        size: { type: ['string', 'null'], description: 'Requested size, including its unit when given.' },
        color: { type: ['string', 'null'], description: 'Requested color.' },
        priceCeiling: {
          type: ['number', 'null'],
          description: 'Maximum price in USD, without a currency symbol.',
        },
        quantity: { type: 'integer', minimum: 1, description: 'Number requested; default to 1.' },
        retailerPreference: {
          type: ['string', 'null'],
          description: 'Preferred retailer, or null when none is stated.',
        },
      },
      required: [
        'productQuery',
        'size',
        'color',
        'priceCeiling',
        'quantity',
        'retailerPreference',
      ],
      additionalProperties: false,
    },
  },
} as const;

function isShoppingIntent(value: unknown): value is ShoppingIntent {
  if (!value || typeof value !== 'object') return false;
  const intent = value as Record<string, unknown>;
  return (
    typeof intent.productQuery === 'string' &&
    intent.productQuery.trim().length > 0 &&
    (intent.size === null || typeof intent.size === 'string') &&
    (intent.color === null || typeof intent.color === 'string') &&
    (intent.priceCeiling === null ||
      (typeof intent.priceCeiling === 'number' && Number.isFinite(intent.priceCeiling))) &&
    Number.isInteger(intent.quantity) &&
    (intent.quantity as number) >= 1 &&
    (intent.retailerPreference === null || typeof intent.retailerPreference === 'string')
  );
}

async function parseShoppingIntent(apiKey: string, message: string): Promise<ShoppingIntent> {
  const response = await fetch(XAI_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROK_MODEL,
      messages: [
        {
          role: 'system',
          content: 'Extract only explicit shopping constraints. Use null when unspecified.',
        },
        { role: 'user', content: message },
      ],
      tools: [shoppingIntentTool],
      tool_choice: { type: 'function', function: { name: 'search_products' } },
      parallel_tool_calls: false,
      temperature: 0,
    }),
  });

  const rawText = await response.text();
  console.log('Raw Grok response:');
  console.log(rawText);

  let raw: GrokResponse;
  try {
    raw = JSON.parse(rawText) as GrokResponse;
  } catch {
    throw new Error(`xAI returned a non-JSON response (HTTP ${response.status}).`);
  }

  if (!response.ok) {
    throw new Error(raw.error?.message ?? `xAI returned HTTP ${response.status}.`);
  }

  const toolCall = raw.choices?.[0]?.message?.tool_calls?.find(
    (call) => call.function?.name === 'search_products',
  );
  if (!toolCall?.function?.arguments) {
    throw new Error('Grok did not return a shopping intent.');
  }

  const intent: unknown = JSON.parse(toolCall.function.arguments);
  if (!isShoppingIntent(intent)) {
    throw new Error('Grok returned a malformed shopping intent.');
  }

  return { ...intent, productQuery: intent.productQuery.trim() };
}

const apiKey = process.env.XAI_API_KEY?.trim();
if (!apiKey) {
  console.error('XAI_API_KEY is not set; no network requests were made.');
  process.exitCode = 1;
} else {
  const queries = [
    'find me Jordan 4s size 11 under $200',
    'red Nike hoodie medium under $60',
    'two black Stanley tumblers from Target under $90 total',
  ];

  for (const query of queries) {
    console.log(`\n=== Query: ${query} ===`);
    try {
      const intent = await parseShoppingIntent(apiKey, query);
      console.log('Parsed ShoppingIntent:');
      console.log(JSON.stringify(intent, null, 2));
    } catch (error) {
      console.error('Request failed:', error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  }
}
