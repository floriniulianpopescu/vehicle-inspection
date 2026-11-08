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
  clients: PickerOption[];
};

export type Appointment = {
  appointmentId: number;
  clientId: number;
  carId: number;
  timeDate: string;
  isDone: boolean;
  duration: number;
  phone: string;
  carLabel: string;
};

export type ClientFilter = { search: string; page: number };
export type CarFilter = {
  search: string;
  frequency: number | null;
  revisionState: RevisionState | null;
  page: number;
};
export type AppointmentFilter = {
  search: string;
  isDone: boolean | null;
  from: string | null;
  to: string | null;
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
};
export type AppointmentInput = {
  appointmentId: number | null;
  clientId: number;
  carId: number;
  timeDate: string;
  isDone: boolean;
  duration: number;
};

export type RevisionPrompt = {
  carId: number;
  plate: string;
  lastRevision: string | null;
  suggested: string | null;
};

export type DeletePreview = {
  cars: string[];
  appointments: { timeDate: string; plate: string }[];
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

export type ReportRequest = {
  from: string;
  to: string;
  workingDays: number[];
  startHour: number;
  endHour: number;
};
export type LoadRow = {
  date: string;
  weekday: number;
  appointments: number;
  bookedMinutes: number;
  capacityMinutes: number;
  overbooked: boolean;
};
export type DueRow = {
  carId: number;
  state: Exclude<RevisionState, "ok">;
  plate: string;
  manufacturer: string;
  model: string;
  lastRevision: string | null;
  nextRevision: string | null;
  phones: string;
};
export type ScheduleRow = {
  appointmentId: number;
  date: string;
  time: string;
  duration: number;
  plate: string;
  manufacturer: string;
  model: string;
  phone: string;
  isDone: boolean;
};
export type Report = {
  generatedAt: string;
  overview: {
    appointments: number;
    completed: number;
    past: number;
    completionRate: number | null;
    bookedMinutes: number;
    overdueCars: number;
    messagesSent: number;
  };
  schedule: ScheduleRow[];
  load: LoadRow[];
  due: DueRow[];
};
export type ReportExportLabels = {
  sheetOverview: string;
  sheetSchedule: string;
  sheetLoad: string;
  sheetDue: string;
  title: string;
  period: string;
  generatedAt: string;
  appointments: string;
  completedOfPast: string;
  completionRate: string;
  overdueCars: string;
  messagesSent: string;
  bookedHours: string;
  appointmentsPerDay: string;
  bookedPerDay: string;
  date: string;
  weekday: string;
  time: string;
  durationMinutes: string;
  plate: string;
  manufacturer: string;
  model: string;
  phone: string;
  done: string;
  yes: string;
  no: string;
  workingHours: string;
  loadPercent: string;
  status: string;
  overbooked: string;
  withinCapacity: string;
  stateLabel: { overdue: string; soon: string; unknown: string };
  lastRevision: string;
  nextRevision: string;
  phones: string;
  weekdays: string[];
};

export type SmsKind = "inspection" | "christmas" | "new_year" | "easter";
export type PendingMessage = {
  key: string;
  kind: SmsKind;
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
export type GatewaySettings = { address: string; username: string; hasPassword: boolean };

export const api = {
  listClients: (filter: ClientFilter) => invoke<Page<Client>>("list_clients", { filter }),
  listCars: (filter: CarFilter) => invoke<Page<Car>>("list_cars", { filter }),
  listAppointments: (filter: AppointmentFilter) =>
    invoke<Page<Appointment>>("list_appointments", { filter }),
  appointmentsBetween: (from: string, to: string) =>
    invoke<Appointment[]>("appointments_between", { from, to }),
  clientOptions: (search: string, linkedTo: number | null) =>
    invoke<PickerOption[]>("client_options", { search, linkedTo }),
  carOptions: (search: string, linkedTo: number | null) =>
    invoke<PickerOption[]>("car_options", { search, linkedTo }),
  saveClient: (input: ClientInput) => invoke<PickerOption>("save_client", { input }),
  saveCar: (input: CarInput) => invoke<PickerOption>("save_car", { input }),
  saveAppointment: (input: AppointmentInput) =>
    invoke<{ revisionPrompt: RevisionPrompt | null }>("save_appointment", { input }),
  setLastRevision: (carId: number, value: string | null) =>
    invoke<void>("set_last_revision", { carId, value }),
  previewDeleteClient: (id: number) => invoke<DeletePreview>("preview_delete_client", { id }),
  previewDeleteCar: (id: number) => invoke<DeletePreview>("preview_delete_car", { id }),
  deleteClient: (id: number) => invoke<void>("delete_client", { id }),
  deleteCar: (id: number) => invoke<void>("delete_car", { id }),
  deleteAppointment: (id: number) => invoke<void>("delete_appointment", { id }),
  smsPending: () => invoke<PendingMessage[]>("sms_pending"),
  smsSend: (keys: string[]) => invoke<void>("sms_send", { keys }),
  smsStop: () => invoke<void>("sms_stop"),
  smsProgress: () => invoke<SendProgress>("sms_progress"),
  smsHistory: (page: number) => invoke<Page<SentMessage>>("sms_history", { page }),
  smsTemplates: () => invoke<SmsTemplate[]>("sms_templates"),
  smsSaveTemplate: (template: SmsTemplate) => invoke<void>("sms_save_template", { template }),
  smsGatewaySettings: () => invoke<GatewaySettings>("sms_gateway_settings"),
  smsSaveGatewaySettings: (address: string, username: string, password: string | null) =>
    invoke<GatewaySettings>("sms_save_gateway_settings", { address, username, password }),
  smsTestGateway: () => invoke<void>("sms_test_gateway"),
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
