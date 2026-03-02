import { Injectable } from '@nestjs/common';
import { MailDataRequired } from '@sendgrid/mail';
import { SendGridClient } from './sendgrid-client';

@Injectable()
export class MailService {
    constructor(private readonly sendGridClient: SendGridClient) { }

    async sendTestEmail(recipient: string, body: string): Promise<void> {
        const mail: MailDataRequired = {
            to: recipient,
            from: 'noreply@domain.com', 
            subject: 'Test email',
            content: [{ type: 'text/plain', value: body }],
        };
        await this.sendGridClient.send(mail);
    }

    async sendEmailWithTemplate(recipient: string, body: string, subject: string): Promise<void> {
        const mail: MailDataRequired = {
            to: recipient,
            cc: 'example@mail.com',
            from: 'noreply@domain.com',
            templateId: 'Sendgrid_template_ID',
            dynamicTemplateData: { body, subject },
        };
        await this.sendGridClient.send(mail);
    }
}