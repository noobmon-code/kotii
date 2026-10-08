// Linhas do banco como o app as recebe (ver supabase/migrations).

import type { DietMeal, DietShoppingItem, ExamResult, WorkoutSession } from '@/domain/health';
import type { ListPriority } from '@/domain/listItem';

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
  /** Outras partes de uma nota comprida, em ordem (a primeira é image_path). */
  extra_image_paths: string[];
  source: 'ai' | 'manual' | 'qrcode';
  status: 'draft' | 'confirmed';
  created_at: string;
  /** Morador que pagou (divisão de gastos). */
  paid_by: string | null;
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
  /** Descrição livre (marca, tamanho, qual embalagem). */
  notes: string | null;
  priority: ListPriority;
  /** Foto do produto certo, em documents/<casa>/. */
  photo_path: string | null;
  checked_at: string | null;
  checked_by: string | null;
  /** Selo trocado a cada marcação: a marcação da fila só grava se o item não mudou. */
  toggle_token: string;
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
  /** Manutenção de um aparelho (ver Equipment). */
  equipment_id: string | null;
  /** Tarefa de uma criança (ficha sem conta no app), que ganha `points` ao concluir. */
  kid_id: string | null;
  points: number;
}

export interface Medication {
  id: string;
  person_id: string | null;
  person_name: string;
  name: string;
  dosage: string | null;
  times: string[];
  start_on: string;
  end_on: string | null;
  notes: string | null;
  active: boolean;
  /** Regularidade (ver MedicationFrequency); mensal cai no dia do mês de start_on. */
  frequency: 'daily' | 'weekdays' | 'interval' | 'monthly';
  /** Dias da semana (0 = domingo), só em 'weekdays'. */
  weekdays: number[] | null;
  /** A cada quantos dias, só em 'interval'. */
  interval_days: number | null;
  /** Tratamento por número de doses. */
  total_doses: number | null;
  /** Doses já registradas como tomadas (contagem do banco). */
  taken_count: number;
}

export interface MedicationDose {
  id: string;
  medication_id: string;
  scheduled_on: string;
  scheduled_time: string;
  taken_at: string;
}

export interface Person {
  id: string;
  name: string;
  kind: 'pessoa' | 'pet';
  member_user_id: string | null;
  birth_date: string | null;
  blood_type: string | null;
  allergies: string | null;
  conditions: string | null;
  health_plan: string | null;
  health_plan_number: string | null;
  species: string | null;
  notes: string | null;
}

export interface Appointment {
  id: string;
  person_id: string;
  title: string;
  professional: string | null;
  location: string | null;
  starts_at: string;
  notes: string | null;
  status: 'agendada' | 'realizada' | 'cancelada';
}

export interface Vaccine {
  id: string;
  person_id: string;
  name: string;
  dose: string | null;
  applied_on: string | null;
  next_dose_on: string | null;
  location: string | null;
  lot: string | null;
  notes: string | null;
}

export interface Exam {
  id: string;
  person_id: string;
  title: string;
  status: 'pedido' | 'agendado' | 'realizado';
  exam_date: string | null;
  requested_by: string | null;
  lab: string | null;
  notes: string | null;
  file_paths: string[];
  results: ExamResult[];
  created_at: string;
}

export type PlanStatus = 'draft' | 'active' | 'archived';

export interface WorkoutPlan {
  id: string;
  person_id: string;
  title: string;
  professional: string | null;
  valid_until: string | null;
  notes: string | null;
  sessions: WorkoutSession[];
  file_paths: string[];
  status: PlanStatus;
  created_at: string;
}

export interface WorkoutLog {
  id: string;
  plan_id: string;
  session_name: string;
  done_on: string;
  done_by: string | null;
  created_at: string;
}

export interface DietPlan {
  id: string;
  person_id: string;
  title: string;
  professional: string | null;
  valid_until: string | null;
  notes: string | null;
  meals: DietMeal[];
  guidelines: string[];
  shopping_items: DietShoppingItem[];
  file_paths: string[];
  status: PlanStatus;
  created_at: string;
}

export interface Equipment {
  id: string;
  name: string;
  category: string;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  location: string | null;
  purchased_on: string | null;
  price: number | null;
  store: string | null;
  warranty_until: string | null;
  notes: string | null;
  file_paths: string[];
  created_at: string;
}

export interface ChoreCompletion {
  id: string;
  chore_id: string;
  completed_by: string | null;
  completed_at: string;
}

/** Documento da família; person_id nulo = documento da casa. */
export interface HomeDocument {
  id: string;
  person_id: string | null;
  kind: string;
  title: string;
  number: string | null;
  issued_on: string | null;
  expires_on: string | null;
  remind_days: number;
  notes: string | null;
  file_paths: string[];
  created_at: string;
}

export interface Bill {
  id: string;
  name: string;
  category: string;
  /** Nulo: valor varia a cada mês. */
  amount: number | null;
  recurrence: 'monthly' | 'yearly' | 'once';
  due_day: number | null;
  next_due_on: string;
  autopay: boolean;
  notes: string | null;
  active: boolean;
  /** Código de barras do boleto do próximo vencimento (44 dígitos); sai ao pagar. */
  boleto: string | null;
  /** Dedutível no Imposto de Renda (plano de saúde), com quem presta o serviço. */
  deductible: boolean;
  provider_name: string | null;
  /** CPF ou CNPJ, só dígitos. */
  provider_doc: string | null;
}

export interface BillPayment {
  id: string;
  bill_id: string;
  due_on: string;
  paid_on: string;
  amount: number;
  paid_by: string | null;
}

/** Limite do mês para uma categoria de gasto (vale todo mês até ser mudado). */
export interface Budget {
  category: string;
  monthly_limit: number;
}

export interface Expense {
  id: string;
  description: string;
  amount: number;
  spent_on: string;
  category: string;
  notes: string | null;
  paid_by: string | null;
  /** Despesa médica dedutível no IR: quem atendeu (CPF/CNPJ só dígitos) e o paciente. */
  deductible: boolean;
  provider_name: string | null;
  provider_doc: string | null;
  patient_id: string | null;
}

// Consultor financeiro (beta): dados do banco (Pluggy), só leitura no app.
// Só a dona, na casa com a liberação, vê essas linhas.

/** Um banco conectado (item do MeuPluggy). */
export interface FinConnection {
  id: string;
  label: string;
  pluggy_item_id: string;
  /** Situação do item na Pluggy (UPDATED, LOGIN_ERROR, OUTDATED, WAITING_USER_INPUT...). */
  status: string | null;
  error_message: string | null;
  /** Quando a Pluggy atualizou o item no banco. */
  item_updated_at: string | null;
  last_synced_at: string | null;
  created_at: string;
}

/** Conta corrente (BANK) ou cartão de crédito (CREDIT). */
export interface FinAccount {
  id: string;
  connection_id: string;
  pluggy_account_id: string;
  type: 'BANK' | 'CREDIT';
  subtype: string | null;
  name: string | null;
  marketing_name: string | null;
  /** Só o final do número. */
  number_last4: string | null;
  /** HMAC-SHA256 do CPF/CNPJ do titular (transferência para si mesmo). */
  owner_doc_hash: string | null;
  /** No cartão: o limite usado (fatura aberta mais as parcelas a vencer), não a próxima fatura. */
  balance: number | null;
  currency_code: string | null;
  credit_limit: number | null;
  available_credit: number | null;
  bill_due_date: string | null;
  bill_close_date: string | null;
  minimum_payment: number | null;
  updated_at: string;
}

/** Lançamento do banco; amount é absoluto e o sentido vem de direction. */
export interface FinTransaction {
  id: string;
  account_id: string;
  pluggy_transaction_id: string;
  /** PENDING conta como "previsto". */
  status: 'PENDING' | 'POSTED';
  direction: 'DEBIT' | 'CREDIT';
  /** Na moeda da conta (R$). */
  amount: number;
  /** Só em compra em moeda estrangeira. */
  original_amount: number | null;
  original_currency: string | null;
  occurred_on: string;
  /** Data da compra no cartão (a parcela cai em outra data). */
  purchase_on: string | null;
  description: string;
  description_raw: string | null;
  category_id: string | null;
  category: string | null;
  operation_type: string | null;
  payment_method: string | null;
  merchant_name: string | null;
  merchant_cnpj: string | null;
  /** Quem recebeu (saída) ou quem pagou (entrada). */
  counterparty_name: string | null;
  counterparty_doc_kind: 'CPF' | 'CNPJ' | null;
  /** HMAC-SHA256 do documento (segredo só da função); CPF nunca vem cru. */
  counterparty_doc_hash: string | null;
  counterparty_cnpj: string | null;
  boleto_barcode: string | null;
  installment_number: number | null;
  total_installments: number | null;
  card_bill_id: string | null;
  bill_forecast: string | null;
  other_credits_type: string | null;
  fee_type: string | null;
  /** Sumiu da Pluggy: fica fora das contas. */
  deleted_at: string | null;
  first_seen_at: string;
  updated_at: string;
}
