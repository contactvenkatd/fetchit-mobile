import * as SecureStore from 'expo-secure-store';

const XAI_CHAT_COMPLETIONS_URL = 'https://api.x.ai/v1/chat/completions';
const GROK_MODEL = 'grok-4.3';
const API_KEY_STORAGE_KEY = 'fetchit.xai_api_key'.replace(/[^a-zA-Z0-9._-]/g, '_');

export interface ShoppingIntent {
  productQuery: string;
  size: string | null;
  color: string | null;
  priceCeiling: number | null;
  quantity: number;
  retailerPreference: string | null;
}

type GrokToolCall = {
  function?: {
    name?: string;
    arguments?: string;
  };
};

type GrokResponse = {
  choices?: Array<{
    message?: {
      tool_calls?: GrokToolCall[];
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

export class GrokServiceError extends Error {
  readonly userMessage =
    "I couldn't understand that shopping request right now. Please try again in a moment.";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'GrokServiceError';
  }
}

/** Save the xAI credential in the device keychain/KeyStore. */
export async function setGrokApiKey(apiKey: string): Promise<void> {
  const value = apiKey.trim();
  if (!value) throw new Error('The xAI API key cannot be empty.');
  await SecureStore.setItemAsync(API_KEY_STORAGE_KEY, value);
}

/** Check for a device-stored credential without exposing its value to the UI. */
export async function hasStoredGrokApiKey(): Promise<boolean> {
  return Boolean(await SecureStore.getItemAsync(API_KEY_STORAGE_KEY));
}

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

export async function parseShoppingIntent(message: string): Promise<ShoppingIntent> {
  const input = message.trim();
  if (!input) throw new GrokServiceError('A shopping request is required.');

  try {
    const environmentApiKey = process.env.XAI_API_KEY?.trim();
    const apiKey = environmentApiKey || (await SecureStore.getItemAsync(API_KEY_STORAGE_KEY));
    if (!apiKey) throw new Error('No xAI API key is configured.');

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
          { role: 'user', content: input },
        ],
        tools: [shoppingIntentTool],
        tool_choice: { type: 'function', function: { name: 'search_products' } },
        parallel_tool_calls: false,
        temperature: 0,
      }),
    });

    const raw = (await response.json()) as GrokResponse;
    if (!response.ok) {
      throw new Error(raw.error?.message ?? `xAI returned HTTP ${response.status}.`);
    }

    const toolCall = raw.choices?.[0]?.message?.tool_calls?.find(
      (call) => call.function?.name === 'search_products',
    );
    if (!toolCall?.function?.arguments) throw new Error('Grok did not return a shopping intent.');

    const intent: unknown = JSON.parse(toolCall.function.arguments);
    if (!isShoppingIntent(intent)) throw new Error('Grok returned a malformed shopping intent.');

    return { ...intent, productQuery: intent.productQuery.trim() };
  } catch (error) {
    if (error instanceof GrokServiceError) throw error;
    throw new GrokServiceError('Grok shopping-intent extraction failed.', {
      cause: error,
    });
  }
}
