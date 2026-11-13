// Type checking only (never runs): what our middleware adds to Express's `req`, so route handlers
// in `// @ts-check` files know about req.staff etc. See server/types.cjs for the shapes.
import type { Staff } from './types.cjs';

declare global {
  namespace Express {
    interface Request {
      /**
       * Set by auth.requireStaff: the signed-in business staff member. Declared as always present
       * because every /api business route sits behind requireStaff (app.cjs); the public webhook
       * and platform routes never read it.
       */
      staff: Staff;
      /** Set by platform.requirePlatformAdmin (every /api/platform route sits behind it); role = platform role. */
      platformAdmin: { id: string; email: string; role: 'owner' | 'manager' | 'developer' };
      /** The exact bytes Meta sent (webhook signature check). */
      rawBody?: Buffer;
      /** Set by broadcastRoutes.requireWhatsApp: the business's WhatsApp connection. */
      wa?: any;
      /** Set by webhook.resolveWebhookBusiness: which business a webhook call belongs to. */
      webhook?: { businessId: string; phoneNumberId: string | null; appSecrets: string[]; verifyTokens: string[] };
    }
  }
}

export {};
