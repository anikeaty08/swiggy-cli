export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramMessage {
  message_id: number;
  text?: string;
  location?: {
    latitude: number;
    longitude: number;
  };
  chat: {
    id: number;
    type: string;
  };
  from?: {
    id: number;
    is_bot?: boolean;
    first_name?: string;
    username?: string;
  };
}

export interface TelegramUserProfile {
  telegramUserId: number;
  swiggyHome: string;
  addressId?: string;
  city?: string;
  lastPlan?: PendingFoodPlan;
  createdAt: string;
  updatedAt: string;
}

export interface PendingFoodPlan {
  kind: "food_order";
  query: string;
  addressId: string;
  createdAt: string;
  recommendation: FoodRecommendation;
}

export interface FoodRecommendation {
  title: string;
  restaurantName?: string;
  restaurantId?: string;
  itemName?: string;
  itemId?: string;
  estimatedTotal?: number;
  savings?: number;
  couponCode?: string;
  addOnSuggestion?: string;
  eta?: string;
  rating?: string;
  raw: unknown;
}
