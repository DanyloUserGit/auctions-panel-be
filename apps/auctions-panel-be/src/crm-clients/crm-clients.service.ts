import { Injectable } from '@nestjs/common';
import { CLIENT_DB, ExternalDbManager } from '../client-db/client-db.service';
import { PrismaService } from '../prisma/prisma.service';

// Призначення клієнтів CRM користувачам (керує SuperAdmin): визначає, чиї процеси й баланси
// бачать User і GA (ТЗ 13.5, 13.6).
@Injectable()
export class CrmClientsService {
  constructor(
    private readonly dbManager: ExternalDbManager,
    private readonly prisma: PrismaService,
  ) { }

  // Усі клієнти з процесів і розрахунків разом із призначеними користувачами.
  async list() {
    const db = await this.dbManager.getConnection(CLIENT_DB.crm);
    const [rows]: any = await db.query(
      `SELECT zamovnyk FROM cars_data WHERE zamovnyk IS NOT NULL AND zamovnyk <> ''
       UNION SELECT zamovnyk FROM transport_payments WHERE zamovnyk IS NOT NULL AND zamovnyk <> ''
       ORDER BY zamovnyk`,
    );

    const assignments = await this.prisma.crmClientAssignment.findMany({
      select: { clientName: true, user: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });

    const names = new Set<string>(rows.map((r: any) => String(r.zamovnyk)));
    assignments.forEach((a) => names.add(a.clientName));

    return [...names].sort((a, b) => a.localeCompare(b)).map((clientName) => ({
      clientName,
      users: assignments.filter((a) => a.clientName === clientName).map((a) => a.user),
    }));
  }

  async setAssignment(clientName: string, userIds: string[]) {
    await this.prisma.$transaction([
      this.prisma.crmClientAssignment.deleteMany({ where: { clientName } }),
      this.prisma.crmClientAssignment.createMany({
        data: [...new Set(userIds)].map((userId) => ({ clientName, userId })),
      }),
    ]);
    return { clientName, userIds };
  }
}
