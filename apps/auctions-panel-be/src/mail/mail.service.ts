import { Injectable } from '@nestjs/common';
import { MailDataRequired } from '@sendgrid/mail';
import { SendGridClient } from './sendgrid-client';

@Injectable()
export class MailService {
  constructor(private readonly sendGridClient: SendGridClient) {}

  async send(recipient: string, body: string, subject: string): Promise<void> {
    const mail: MailDataRequired = {
      to: recipient,
      from: process.env.SENDGRID_CLIENT_ID!,
      subject,
      content: [{ type: 'text/html', value: body }],
    };
    await this.sendGridClient.send(mail);
  }
}
