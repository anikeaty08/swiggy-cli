export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
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

export interface TelegramCallbackQuery {
  id: string;
  data?: string;
  message?: TelegramMessage;
  from: {
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
  manualAddress?: string;
  manualLatitude?: number;
  manualLongitude?: number;
  city?: string;
  lastPlan?: PendingFoodPlan;
  lastSearch?: FoodSearchSession;
  lastInstamartPlan?: PendingInstamartPlan;
  lastInstamartSearch?: InstamartSearchSession;
  lastDineoutSearch?: DineoutSearchSession;
  createdAt: string;
  updatedAt: string;
}

export interface PendingFoodPlan {
  kind: "food_order";
  query: string;
  addressId: string;
  createdAt: string;
  recommendation: FoodRecommendation;
  items?: FoodPlanItem[];
  discount?: FoodDiscountSummary;
}

export interface FoodPlanItem {
  recommendation: FoodRecommendation;
  quantity: number;
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

export type FoodSearchMode = "best_value" | "cheapest";

export interface FoodSearchSession {
  kind: "food_search";
  query: string;
  mode: FoodSearchMode;
  addressId: string;
  page: number;
  options: FoodRecommendation[];
  mealOptions?: FoodMealOption[];
  createdAt: string;
}

export interface FoodMealOption {
  restaurantName?: string;
  restaurantId?: string;
  items: FoodPlanItem[];
  estimatedTotal: number;
  discount?: FoodDiscountSummary;
}

export interface FoodDiscountSummary {
  foodCouponCode?: string;
  foodCouponSavings?: number;
  foodCouponMinimum?: number;
  addOnNeeded?: number;
  addOnWorthIt?: boolean;
  paymentOfferNote?: string;
}

export interface PendingInstamartPlan {
  kind: "instamart_cart";
  query: string;
  addressId: string;
  createdAt: string;
  product: InstamartProduct;
  quantity: number;
}

export interface InstamartProduct {
  title: string;
  spinId?: string;
  brand?: string;
  price?: number;
  mrp?: number;
  quantityText?: string;
  raw: unknown;
}

export interface InstamartSearchSession {
  kind: "instamart_search";
  query: string;
  addressId: string;
  page: number;
  options: InstamartProduct[];
  createdAt: string;
}

export interface DineoutRestaurant {
  title: string;
  restaurantId?: string;
  area?: string;
  rating?: string;
  costForTwo?: string;
  offer?: string;
  raw: unknown;
}

export interface DineoutSearchSession {
  kind: "dineout_search";
  query: string;
  page: number;
  latitude?: number;
  longitude?: number;
  addressId?: string;
  options: DineoutRestaurant[];
  createdAt: string;
}
