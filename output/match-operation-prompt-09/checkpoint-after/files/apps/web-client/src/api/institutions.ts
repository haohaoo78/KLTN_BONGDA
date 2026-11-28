import { apiFetch } from "./client";

export type InstitutionType = "UNIVERSITY" | "COLLEGE" | "OTHER";

export type Institution = {
  id: string;
  name: string;
  shortName: string | null;
  code: string | null;
  admissionCode: string | null;
  institutionType: InstitutionType;
  address: string | null;
  officialWebsite: string | null;
  city: string | null;
  dataSourceUrl: string | null;
  dataCollectedAt: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  status: "DRAFT" | "ACTIVE" | "SUSPENDED";
  isActive: boolean;
};

export type InstitutionInput = {
  name: string;
  code?: string | null;
  shortName?: string | null;
  admissionCode?: string | null;
  institutionType: InstitutionType;
  address?: string | null;
  officialWebsite?: string | null;
  city?: string | null;
  dataSourceUrl?: string | null;
  dataCollectedAt?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
};

export function getInstitutions(filters: {
  institutionType?: InstitutionType;
  search?: string;
} = {}): Promise<{ institutions: Institution[] }> {
  const query = new URLSearchParams({ isActive: "true" });
  if (filters.institutionType) query.set("institutionType", filters.institutionType);
  if (filters.search) query.set("search", filters.search);
  return apiFetch(`/institutions?${query.toString()}`);
}

export function getManagedInstitutions(filters: {
  search?: string;
  institutionType?: InstitutionType;
  status?: Institution["status"];
} = {}): Promise<{ institutions: Institution[] }> {
  const query = new URLSearchParams();
  if (filters.search) query.set("search", filters.search);
  if (filters.institutionType) query.set("institutionType", filters.institutionType);
  if (filters.status) query.set("status", filters.status);
  return apiFetch(`/institutions/manage?${query.toString()}`);
}

export function createInstitution(
  input: InstitutionInput,
): Promise<{ institution: Institution }> {
  return apiFetch("/institutions", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateInstitution(
  id: string,
  input: Partial<InstitutionInput>,
): Promise<{ institution: Institution }> {
  return apiFetch(`/institutions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function setInstitutionStatus(
  id: string,
  status: Institution["status"],
): Promise<{ institution: Institution }> {
  return apiFetch(`/institutions/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export type InstitutionHistoryItem = {
  id: number;
  actorId: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  changedAt: string;
};

export function getInstitutionHistory(
  id: string,
): Promise<{ history: InstitutionHistoryItem[] }> {
  return apiFetch(`/institutions/${encodeURIComponent(id)}/history`);
}