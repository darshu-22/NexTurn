export interface User {
  id: string;
  tenantId: string;
  name: string;
  email: string | null;
  role: "PLATFORM_ADMIN" | "ORGANIZATION_ADMIN" | "QUEUE_OPERATOR" | "USER";
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
}

export interface Queue {
  id: string;
  tenantId: string;
  name: string;
  status: "ACTIVE" | "PAUSED" | "CLOSED";
  joinEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface QueueEntry {
  id: string;
  tenantId: string;
  queueId: string;
  name: string;
  phone?: string | null;
  status: "WAITING" | "COMPLETED" | "CANCELLED";
  position: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  cancelledAt?: string | null;
}

export interface QueueEvent {
  id: string;
  tenantId: string;
  queueId: string;
  queueEntryId?: string | null;
  eventType:
    | "QUEUE_JOINED"
    | "QUEUE_COMPLETED"
    | "QUEUE_CANCELLED"
    | "QUEUE_REMOVED"
    | "QUEUE_REORDERED";
  actorId?: string | null;
  actorRole?: string | null;
  payload?: any;
  createdAt: string;
}

export interface QueueStatusResponse {
  entry: QueueEntry;
  peopleAhead: number;
  queueName: string;
}
