// Linhas do banco como o app as recebe (ver supabase/migrations).

export type Unit = 'un' | 'kg' | 'g' | 'l' | 'ml';
export const UNITS: Unit[] = ['un', 'kg', 'g', 'l', 'ml'];

export interface Household {
  id: string;
  name: string;
  invite_code: string;
  created_by: string;
}

export interface Member {
  household_id: string;
  user_id: string;
  display_name: string;
  role: 'owner' | 'member';
}

export interface Store {
  id: string;
  name: string;
  cnpj: string | null;
  address: string | null;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  shelf_life_days: number | null;
}

export interface Receipt {
  id: string;
  store_id: string | null;
  purchased_at: string;
  total: number | null;
  access_key: string | null;
  image_path: string | null;
  source: 'ai' | 'manual';
  status: 'draft' | 'confirmed';
  created_at: string;
  store: Pick<Store, 'id' | 'name'> | null;
}

export interface ReceiptItem {
  id: string;
  receipt_id: string;
  position: number;
  raw_description: string;
  suggested_name: string | null;
  suggested_category: string | null;
  product_id: string | null;
  quantity: number;
  unit: Unit;
  unit_price: number;
  total_price: number;
}

export interface LatestPrice {
  product_id: string;
  store_id: string;
  unit: Unit;
  unit_price: number;
  purchased_at: string;
}

export interface PriceObservation extends LatestPrice {
  receipt_id: string;
}

export type ListKind = 'mercado' | 'farmacia' | 'outros';

export interface ShoppingList {
  id: string;
  name: string;
  kind: ListKind;
  archived_at: string | null;
  created_at: string;
}

export interface ShoppingListItem {
  id: string;
  list_id: string;
  product_id: string | null;
  name: string;
  category: string;
  quantity: number;
  unit: Unit;
  checked_at: string | null;
  checked_by: string | null;
  created_at: string;
}

export interface PantryItem {
  id: string;
  product_id: string | null;
  name: string;
  category: string;
  quantity: number;
  unit: Unit;
  purchased_on: string;
  expires_on: string | null;
  expiry_source: 'categoria' | 'produto' | 'manual' | null;
  consumed_at: string | null;
}

export interface Chore {
  id: string;
  title: string;
  notes: string | null;
  recurrence: 'none' | 'daily' | 'weekly' | 'monthly';
  interval_count: number;
  due_on: string;
  assigned_to: string | null;
  active: boolean;
}

export interface Medication {
  id: string;
  person_name: string;
  name: string;
  dosage: string | null;
  times: string[];
  start_on: string;
  end_on: string | null;
  notes: string | null;
  active: boolean;
}

export interface MedicationDose {
  id: string;
  medication_id: string;
  scheduled_on: string;
  scheduled_time: string;
  taken_at: string;
}
