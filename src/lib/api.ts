import { invoke } from "@tauri-apps/api/core";
import type { Messages } from "@/locales/ro";

export const PAGE_SIZE = 50;

export type Frequency = 6 | 12 | 24;
export type RevisionState = "overdue" | "soon" | "ok" | "unknown";

export type Page<T> = { rows: T[]; total: number };
export type PickerOption = { id: number; label: string; linked: boolean };

export type Client = { clientId: number; phone: string; smsOptOut: boolean; cars: PickerOption[] };

export type Car = {
  carId: number;
  plate: string;
  manufacturer: string;
  model: string;
  lastRevision: string | null;
  revisionFrequency: Frequency;
  nextRevision: string | null;
  revisionState: RevisionState;
  /** The client who brought the car to its last inspection, when known. */
  inspectedBy: number | null;
  clients: PickerOption[];
};

export type ClientFilter = { search: string; page: number };
export type CarSort = "plate" | "newest" | "oldest";
export type CarFilter = {
  search: string;
  frequency: number | null;
  revisionState: RevisionState | null;
  revisionFrom: string | null;
  revisionTo: string | null;
  sort: CarSort;
  page: number;
};
export type ClientInput = {
  clientId: number | null;
  phone: string;
  smsOptOut: boolean;
  carIds: number[];
};
export type CarInput = {
  carId: number | null;
  plate: string;
  manufacturer: string;
  model: string;
  lastRevision: string | null;
  revisionFrequency: number;
  clientIds: number[];
  inspectedBy: number | null;
  /** Typed numbers that become new clients linked to the car. */
  newPhones: string[];
  /** Set instead of inspectedBy when one of newPhones brought the car. */
  inspectedByPhone: string | null;
};
export type DeletePreview = {
  cars: string[];
  inspections: number;
  messages: number;
};

export type BackupStatus = {
  configured: boolean;
  connected: boolean;
  account: string | null;
  hasPassphrase: boolean;
  retention: number;
  lastBackupAt: string | null;
  lastError: string | null;
  localEmpty: boolean;
};
export type RemoteBackup = { id: string; name: string; createdTime: string; size: string | null };

export type ReportRequest = { from: string; to: string; expiringDays: number };
export type InspectedRow = {
  inspectionId: number;
  date: string;
  carId: number;
  plate: string;
  manufacturer: string;
  model: string;
  phone: string | null;
  nextRevision: string | null;
};
export type DueRow = {
  carId: number;
  plate: string;
  manufacturer: string;
  model: string;
  lastRevision: string;
  nextRevision: string;
  days: number;
  phones: string;
};
export type RepeatCar = {
  carId: number;
  plate: string;
  manufacturer: string;
  model: string;
  visits: number;
  firstVisit: string;
  lastVisit: string;
  phones: string;
};
export type RepeatClient = {
  clientId: number;
  phone: string;
  visits: number;
  plates: string;
  lastVisit: string;
};
export type Report = {
  generatedAt: string;
  inspected: InspectedRow[];
  expiring: DueRow[];
  expired: DueRow[];
  repeatCars: RepeatCar[];
  repeatClients: RepeatClient[];
};
export type ReportExportLabels = {
  sheetInspected: string;
  sheetExpiring: string;
  sheetExpired: string;
  sheetRepeatCars: string;
  sheetRepeatClients: string;
  date: string;
  plate: string;
  manufacturer: string;
  model: string;
  broughtBy: string;
  phone: string;
  phones: string;
  lastRevision: string;
  nextRevision: string;
  daysLeft: string;
  daysOverdue: string;
  visits: string;
  firstVisit: string;
  lastVisit: string;
  plates: string;
};

/** The longest look-ahead for expiring inspections, about six months. */
export const MAX_EXPIRING_DAYS = 180;

export type SmsKind = "inspection" | "christmas" | "new_year" | "easter";
export type PendingMessage = {
  key: string;
  kind: SmsKind;
  channel: "sms" | "whatsapp";
  clientId: number;
  carId: number | null;
  phone: string;
  plate: string | null;
  dueDate: string;
  text: string;
};
export type SentMessage = {
  messageId: number;
  kind: SmsKind;
  phone: string;
  plate: string | null;
  text: string;
  sentAt: string;
  status: "sent" | "failed";
};
export type SendProgress = {
  active: boolean;
  total: number;
  done: number;
  sent: number;
  failed: number;
  error: string | null;
};
export type SmsTemplate = { kind: SmsKind; text: string };
export type WhatsAppConnection = "closed" | "loading" | "qr" | "ready";
export type GatewaySettings = { address: string; username: string; hasPassword: boolean };

export const api = {
  listClients: (filter: ClientFilter) => invoke<Page<Client>>("list_clients", { filter }),
  listCars: (filter: CarFilter) => invoke<Page<Car>>("list_cars", { filter }),
  clientOptions: (search: string, linkedTo: number | null) =>
    invoke<PickerOption[]>("client_options", { search, linkedTo }),
  carOptions: (search: string, linkedTo: number | null) =>
    invoke<PickerOption[]>("car_options", { search, linkedTo }),
  saveClient: (input: ClientInput) => invoke<PickerOption>("save_client", { input }),
  saveCar: (input: CarInput) => invoke<PickerOption>("save_car", { input }),
  previewDeleteClient: (id: number) => invoke<DeletePreview>("preview_delete_client", { id }),
  previewDeleteCar: (id: number) => invoke<DeletePreview>("preview_delete_car", { id }),
  deleteClient: (id: number) => invoke<void>("delete_client", { id }),
  deleteCar: (id: number) => invoke<void>("delete_car", { id }),
  smsReminderDays: () => invoke<number>("sms_reminder_days"),
  smsSetReminderDays: (days: number) => invoke<void>("sms_set_reminder_days", { days }),
  smsPending: () => invoke<PendingMessage[]>("sms_pending"),
  smsSend: (keys: string[], intervalSeconds: number) =>
    invoke<void>("sms_send", { keys, intervalSeconds }),
  smsIntervalSeconds: (channel: "sms" | "whatsapp") =>
    invoke<number>("sms_interval_seconds", { channel }),
  smsStop: () => invoke<void>("sms_stop"),
  smsProgress: () => invoke<SendProgress>("sms_progress"),
  smsHistory: (page: number) => invoke<Page<SentMessage>>("sms_history", { page }),
  smsTemplates: () => invoke<SmsTemplate[]>("sms_templates"),
  smsSaveTemplate: (template: SmsTemplate) => invoke<void>("sms_save_template", { template }),
  smsGatewaySettings: () => invoke<GatewaySettings>("sms_gateway_settings"),
  smsSaveGatewaySettings: (address: string, username: string, password: string | null) =>
    invoke<GatewaySettings>("sms_save_gateway_settings", { address, username, password }),
  smsTestGateway: () => invoke<void>("sms_test_gateway"),
  whatsappStatus: () => invoke<WhatsAppConnection>("whatsapp_status"),
  whatsappOpen: () => invoke<void>("whatsapp_open"),
  whatsappLogOut: () => invoke<void>("whatsapp_log_out"),
  report: (request: ReportRequest) => invoke<Report>("report", { request }),
  exportReport: (request: ReportRequest, labels: ReportExportLabels, fileName: string) =>
    invoke<string | null>("export_report", { request, labels, fileName }),
  backupStatus: () => invoke<BackupStatus>("backup_status"),
  backupConnect: () => invoke<BackupStatus>("backup_connect"),
  backupCancelConnect: () => invoke<void>("backup_cancel_connect"),
  backupDisconnect: () => invoke<BackupStatus>("backup_disconnect"),
  backupSetPassphrase: (passphrase: string) =>
    invoke<BackupStatus>("backup_set_passphrase", { passphrase }),
  backupSetRetention: (retention: number) => invoke<void>("backup_set_retention", { retention }),
  backupNow: () => invoke<BackupStatus>("backup_now"),
  backupList: () => invoke<RemoteBackup[]>("backup_list"),
  backupRestore: (id: string, passphrase: string | null) =>
    invoke<string>("backup_restore", { id, passphrase }),
};

export function errorMessage(t: Messages, error: unknown): string {
  const errors: Record<string, string> = t.data.errors;
  return (typeof error === "string" && errors[error]) || errors.generic;
}
