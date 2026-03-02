import { Injectable, Logger } from '@nestjs/common';
import SendGrid, { MailDataRequired } from '@sendgrid/mail';
@Injectable()
export class SendGridClient {
    private logger: Logger;
    constructor() { SendGrid.setApiKey(process.env.SENDGRID_API_KEY!); this.logger = new Logger(SendGridClient.name); }
    async send(mail: MailDataRequired): Promise<void> {
        try {
            await SendGrid.send(mail);
            this.logger.log(`Email successfully dispatched to ${mail.to as string}`);
        } catch (error) {
            this.logger.error('Error while sending email', error);
            throw error;
        }
    }
}
