import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Helper: E.164 Regex Validation (+ followed by 1 to 15 digits)
export function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{1,14}$/.test(phone.trim());
}

// Helper: Mask phone numbers for privacy in logs
export function maskPhoneNumber(phone: string): string {
  if (!phone) return "N/A";
  const trimmed = phone.trim();
  if (trimmed.length <= 5) return "***";
  const prefix = trimmed.substring(0, 3);
  const suffix = trimmed.substring(trimmed.length - 4);
  return `${prefix}****${suffix}`;
}

// Notification Provider Interface
export interface INotificationProvider {
  sendWhatsApp(
    to: string,
    message: string,
  ): Promise<{ providerMessageId?: string }>;
  sendSMS(to: string, message: string): Promise<{ providerMessageId?: string }>;
}

// Console Notification Provider (Local Dev & Testing)
export class ConsoleNotificationProvider implements INotificationProvider {
  public sentLogs: Array<{
    channel: "WHATSAPP" | "SMS";
    to: string;
    message: string;
    messageId: string;
  }> = [];

  async sendWhatsApp(to: string, message: string) {
    const messageId = `console-wa-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    console.log(
      `[CONSOLE WHATSAPP] To: ${maskPhoneNumber(to)} | Msg: "${message}" | SID: ${messageId}`,
    );
    this.sentLogs.push({ channel: "WHATSAPP", to, message, messageId });
    return { providerMessageId: messageId };
  }

  async sendSMS(to: string, message: string) {
    const messageId = `console-sms-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    console.log(
      `[CONSOLE SMS] To: ${maskPhoneNumber(to)} | Msg: "${message}" | SID: ${messageId}`,
    );
    this.sentLogs.push({ channel: "SMS", to, message, messageId });
    return { providerMessageId: messageId };
  }
}

// Twilio Notification Provider
export class TwilioNotificationProvider implements INotificationProvider {
  private accountSid: string;
  private authToken: string;
  private whatsappNumber: string;
  private smsNumber: string;

  constructor(
    accountSid?: string,
    authToken?: string,
    whatsappNumber?: string,
    smsNumber?: string,
  ) {
    this.accountSid = accountSid || process.env.TWILIO_ACCOUNT_SID || "";
    this.authToken = authToken || process.env.TWILIO_AUTH_TOKEN || "";
    this.whatsappNumber =
      whatsappNumber || process.env.TWILIO_WHATSAPP_NUMBER || "";
    this.smsNumber = smsNumber || process.env.TWILIO_SMS_NUMBER || "";
  }

  async sendWhatsApp(to: string, message: string) {
    if (!this.accountSid || !this.authToken) {
      throw new Error("Twilio credentials missing");
    }
    const fromNum = this.whatsappNumber.startsWith("whatsapp:")
      ? this.whatsappNumber
      : `whatsapp:${this.whatsappNumber}`;
    const toNum = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;

    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString(
      "base64",
    );
    const bodyParams = new URLSearchParams();
    bodyParams.append("From", fromNum);
    bodyParams.append("To", toNum);
    bodyParams.append("Body", message);

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: bodyParams.toString(),
      },
    );

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || `Twilio HTTP error ${res.status}`);
    }
    return { providerMessageId: data.sid };
  }

  async sendSMS(to: string, message: string) {
    if (!this.accountSid || !this.authToken) {
      throw new Error("Twilio credentials missing");
    }
    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString(
      "base64",
    );
    const bodyParams = new URLSearchParams();
    bodyParams.append("From", this.smsNumber);
    bodyParams.append("To", to);
    bodyParams.append("Body", message);

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: bodyParams.toString(),
      },
    );

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || `Twilio HTTP error ${res.status}`);
    }
    return { providerMessageId: data.sid };
  }
}

// Notification Service Manager
export class NotificationService {
  public provider: INotificationProvider;

  constructor(provider?: INotificationProvider) {
    const providerMode = (
      process.env.NOTIFICATION_PROVIDER || "console"
    ).toLowerCase();

    if (provider) {
      this.provider = provider;
    } else if (providerMode === "twilio") {
      this.provider = new TwilioNotificationProvider();
    } else {
      this.provider = new ConsoleNotificationProvider();
    }
  }

  private isWhatsAppEnabled(): boolean {
    if (process.env.NOTIFICATION_PROVIDER === "disabled") return false;
    return process.env.ENABLE_WHATSAPP === "true";
  }

  private isSMSEnabled(): boolean {
    if (process.env.NOTIFICATION_PROVIDER === "disabled") return false;
    return process.env.ENABLE_SMS === "true";
  }

  // Core Dispatcher Function with DB-Enforced Idempotency (@@unique([queueEntryId, eventType, channel]))
  public async dispatchNotification(
    entry: {
      id: string;
      tenantId: string;
      queueId: string;
      name: string;
      phone?: string | null;
      position: number;
    },
    eventType:
      "QUEUE_JOINED" | "YOUR_TURN" | "QUEUE_COMPLETED" | "QUEUE_CLEARED",
    messageTemplate: string,
  ): Promise<void> {
    if (!entry.phone) return;

    const phone = entry.phone.trim();
    const valid = isValidE164(phone);

    const channels: Array<"WHATSAPP" | "SMS"> = [];
    if (this.isWhatsAppEnabled()) channels.push("WHATSAPP");
    if (this.isSMSEnabled()) channels.push("SMS");

    if (channels.length === 0) return;

    const message = messageTemplate
      .replace("{name}", entry.name)
      .replace("{position}", entry.position.toString());

    for (const channel of channels) {
      if (!valid) {
        // Record SKIPPED due to invalid E.164 phone format
        try {
          await prisma.notificationLog.create({
            data: {
              tenantId: entry.tenantId,
              queueId: entry.queueId,
              queueEntryId: entry.id,
              channel,
              eventType,
              status: "SKIPPED",
              recipient: maskPhoneNumber(phone),
              errorMessage: "Invalid E.164 phone number format",
            },
          });
        } catch (err: any) {
          // Ignore unique constraint conflict
        }
        continue;
      }

      // Step 1: Database-Enforced Idempotency check via unique record creation
      let logRecord;
      try {
        logRecord = await prisma.notificationLog.create({
          data: {
            tenantId: entry.tenantId,
            queueId: entry.queueId,
            queueEntryId: entry.id,
            channel,
            eventType,
            status: "PENDING",
            recipient: maskPhoneNumber(phone),
          },
        });
      } catch (err: any) {
        // Unique constraint code P2002 -> Record already exists for (queueEntryId, eventType, channel)!
        if (err.code === "P2002") {
          continue; // Quietly skip duplicate notification
        }
        console.error("Notification log creation error:", err.message);
        continue;
      }

      // Step 2: Send Notification via Provider (INDEPENDENT CHANNELS - No auto fallback)
      try {
        let result: { providerMessageId?: string } = {};
        if (channel === "WHATSAPP") {
          result = await this.provider.sendWhatsApp(phone, message);
        } else if (channel === "SMS") {
          result = await this.provider.sendSMS(phone, message);
        }

        // Update NotificationLog to SENT
        await prisma.notificationLog.update({
          where: { id: logRecord.id },
          data: {
            status: "SENT",
            providerMessageId: result.providerMessageId || null,
          },
        });
      } catch (err: any) {
        // Record FAILED without throwing (Non-blocking guarantee!)
        try {
          await prisma.notificationLog.update({
            where: { id: logRecord.id },
            data: {
              status: "FAILED",
              errorMessage: err.message || "Provider dispatch failed",
            },
          });
        } catch (dbErr) {}
        console.error(
          `[NOTIFICATION FAILED] Channel: ${channel} | Recipient: ${maskPhoneNumber(phone)} | Error: ${err.message}`,
        );
      }
    }
  }

  // Helper Methods for specific events
  public async sendQueueJoined(entry: any, queueName: string) {
    const template = `Hi {name}, you joined ${queueName}. Your position is #{position}.`;
    await this.dispatchNotification(entry, "QUEUE_JOINED", template);
  }

  public async sendYourTurnAlert(entry: any, queueName: string) {
    const template = `Hi {name}, it's your turn at ${queueName}! Please proceed to the counter.`;
    await this.dispatchNotification(entry, "YOUR_TURN", template);
  }

  public async sendQueueCompleted(entry: any, queueName: string) {
    const template = `Hi {name}, thank you for visiting ${queueName}!`;
    await this.dispatchNotification(entry, "QUEUE_COMPLETED", template);
  }

  public async sendQueueCleared(entry: any, queueName: string) {
    const template = `Notice: Queue ${queueName} is now clear.`;
    await this.dispatchNotification(entry, "QUEUE_CLEARED", template);
  }
}

export const defaultNotificationService = new NotificationService();
