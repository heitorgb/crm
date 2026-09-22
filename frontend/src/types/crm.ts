export type CustomerStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

export interface TagSummary {
  id: string;
  name: string;
  color: string | null;
}

export interface Tag extends TagSummary {
  customerCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerContact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  position: string | null;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Customer {
  id: string;
  name: string;
  document: string | null;
  status: CustomerStatus;
  tags: TagSummary[];
  contactCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerDetail extends Omit<Customer, 'contactCount'> {
  contacts: CustomerContact[];
}

export interface Contact {
  id: string;
  customerId: string;
  customerName: string;
  name: string;
  email: string | null;
  phone: string | null;
  position: string | null;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PaginationMeta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

export interface PageResult<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface CustomerInput {
  name: string;
  document?: string | null;
  status?: CustomerStatus;
  tagIds?: string[];
}

export interface ContactInput {
  customerId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  position?: string | null;
  isPrimary?: boolean;
}

export interface TagInput {
  name: string;
  color?: string | null;
}
