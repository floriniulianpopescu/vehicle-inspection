import { invoke } from "@tauri-apps/api/core";
import type { Messages } from "@/locales/ro";

export const PAGE_SIZE = 50;

export type Frequency = 6 | 12 | 24;
export type RevisionState = "overdue" | "soon" | "ok" | "unknown";

export type Page<T> = { rows: T[]; total: number };
export type PickerOption = { id: number; label: string; linked: boolean };

export type Client = { clientId: number; phone: string; cars: PickerOption[] };

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

export type ClientInput = { clientId: number | null; phone: string; carIds: number[] };
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
};

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
};

export function errorMessage(t: Messages, error: unknown): string {
  const errors: Record<string, string> = t.data.errors;
  return (typeof error === "string" && errors[error]) || errors.generic;
}
