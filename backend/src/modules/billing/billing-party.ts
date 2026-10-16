import type { Prisma } from '@prisma/client';
import {
  BillingContactNotFoundError,
  BillingCustomerNotFoundError,
  BillingPartyRequiredError,
} from './billing.errors.js';

export interface BillingParty {
  customerId: string | null;
  contactId: string | null;
}

/**
 * Validates that the charge party (an existing Customer and/or Contact) belongs
 * to the tenant and resolves the effective customer: an explicit customer wins,
 * otherwise the contact's linked customer is reused. A charge must reference at
 * least a contact or a customer; no Customer is ever created automatically.
 */
export async function resolveBillingParty(
  client: Prisma.TransactionClient,
  tenantId: string,
  customerId: string | null | undefined,
  contactId: string | null | undefined,
): Promise<BillingParty> {
  const contactCustomerId = contactId
    ? await assertBillingContact(client, tenantId, contactId, customerId)
    : null;

  if (customerId) {
    const customer = await client.customer.findFirst({
      where: { id: customerId, tenantId },
      select: { id: true },
    });
    if (!customer) {
      throw new BillingCustomerNotFoundError();
    }
  }

  const effectiveCustomerId = customerId ?? contactCustomerId ?? null;
  if (!effectiveCustomerId && !contactId) {
    throw new BillingPartyRequiredError();
  }

  return { customerId: effectiveCustomerId, contactId: contactId ?? null };
}

/** Validates a contact belongs to the tenant and, when given, to the customer. */
export async function assertBillingContact(
  client: Prisma.TransactionClient,
  tenantId: string,
  contactId: string,
  customerId?: string | null,
): Promise<string | null> {
  const contact = await client.contact.findFirst({
    where: { id: contactId, tenantId },
    select: { customerId: true },
  });
  if (!contact || (customerId && contact.customerId && contact.customerId !== customerId)) {
    throw new BillingContactNotFoundError();
  }
  return contact.customerId;
}
