import type { ServerName } from "../types/index.js";

type JsonSchema = {
  type?: string | string[];
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  additionalProperties?: boolean;
};

export const SCHEMA_FIXTURES: Record<ServerName, Record<string, JsonSchema>> = {
  food: {
    get_restaurant_menu: objectSchema(["restaurantId", "addressId"], {
      restaurantId: { type: "string" },
      addressId: { type: "string" },
      page: { type: "number" },
      pageSize: { type: "number" },
    }),
    update_food_cart: objectSchema(["restaurantId", "addressId", "cartItems"], {
      restaurantId: { type: "string" },
      addressId: { type: "string" },
      restaurantName: { type: "string" },
      cartItems: {
        type: "array",
        items: objectSchema(["itemId", "quantity"], {
          itemId: { type: "string" },
          quantity: { type: "number" },
        }),
      },
    }),
    place_food_order: objectSchema(["addressId"], {
      addressId: { type: "string" },
      paymentMethod: { type: "string" },
    }),
  },
  instamart: {
    update_cart: objectSchema(["selectedAddressId", "items"], {
      selectedAddressId: { type: "string" },
      items: {
        type: "array",
        items: objectSchema(["spinId", "quantity"], {
          spinId: { type: "string" },
          quantity: { type: "number" },
        }),
      },
    }),
    checkout: objectSchema(["addressId"], {
      addressId: { type: "string" },
      paymentMethod: { type: "string" },
    }),
    track_order: objectSchema(["orderId", "lat", "lng"], {
      orderId: { type: "string" },
      lat: { type: "number" },
      lng: { type: "number" },
    }),
  },
  dineout: {
    search_restaurants_dineout: objectSchema(["query"], {
      query: { type: "string" },
      entityType: { type: "string" },
      addressId: { type: "string" },
      latitude: { type: "number" },
      longitude: { type: "number" },
    }),
    get_restaurant_details: objectSchema(["restaurantId", "latitude", "longitude"], {
      restaurantId: { type: "string" },
      latitude: { type: "number" },
      longitude: { type: "number" },
    }),
    get_available_slots: objectSchema(["restaurantId", "date", "latitude", "longitude"], {
      restaurantId: { type: "string" },
      date: { type: "string" },
      latitude: { type: "number" },
      longitude: { type: "number" },
    }),
    get_booking_status: objectSchema(["orderId"], {
      orderId: { type: "string" },
    }),
  },
};

export function validateToolInput(
  server: ServerName,
  tool: string,
  input: unknown,
  schema: unknown = SCHEMA_FIXTURES[server]?.[tool]
): { ok: true } | { ok: false; errors: string[] } {
  if (!schema || typeof schema !== "object") return { ok: true };
  const errors: string[] = [];
  validate(input, schema as JsonSchema, "$", errors);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function objectSchema(required: string[], properties: Record<string, JsonSchema>): JsonSchema {
  return { type: "object", required, properties, additionalProperties: true };
}

function validate(value: unknown, schema: JsonSchema, path: string, errors: string[]): void {
  if (schema.type && !matchesType(value, schema.type)) {
    errors.push(`${path} must be ${Array.isArray(schema.type) ? schema.type.join("|") : schema.type}`);
    return;
  }
  if (schema.type === "object" || schema.properties || schema.required) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`${path} must be object`);
      return;
    }
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (record[key] === undefined || record[key] === "") errors.push(`${path}.${key} is required`);
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (record[key] !== undefined) validate(record[key], child, `${path}.${key}`, errors);
    }
    if (schema.additionalProperties === false) {
      const known = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(record)) {
        if (!known.has(key)) errors.push(`${path}.${key} is not allowed`);
      }
    }
  }
  if (schema.type === "array" || schema.items) {
    if (!Array.isArray(value)) {
      errors.push(`${path} must be array`);
      return;
    }
    if (schema.items) value.forEach((item, index) => validate(item, schema.items!, `${path}[${index}]`, errors));
  }
}

function matchesType(value: unknown, type: string | string[]): boolean {
  const types = Array.isArray(type) ? type : [type];
  return types.some((t) => {
    if (t === "array") return Array.isArray(value);
    if (t === "object") return Boolean(value && typeof value === "object" && !Array.isArray(value));
    if (t === "integer") return Number.isInteger(value);
    if (t === "number") return typeof value === "number" && Number.isFinite(value);
    if (t === "null") return value === null;
    return typeof value === t;
  });
}
