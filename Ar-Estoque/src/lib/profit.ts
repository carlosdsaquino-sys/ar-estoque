export interface ProfitMaterialInput {
  quantity: number;
  unit_cost: number;
  subtotal?: number;
}

export interface ProfitServiceInput {
  status: string;
  payment_status: string;
  total_value: number;
  discount: number;
  materials: ProfitMaterialInput[];
}

export function calculateMaterialCost(materials: ProfitMaterialInput[]): number {
  return materials.reduce((sum, material) => {
    const lineCost = Number(material.quantity) * Number(material.unit_cost);
    return sum + (Number.isFinite(lineCost) ? Math.round((lineCost + Number.EPSILON) * 100) / 100 : 0);
  }, 0);
}

export function summarizeConfirmedProfits(services: ProfitServiceInput[]) {
  return services.filter(service => service.status === 'confirmado').reduce((summary, service) => {
    const revenue = Number(service.total_value || 0);
    const cost = calculateMaterialCost(service.materials);
    const materialsSold = service.materials.reduce((sum, material) => sum + Number(material.subtotal || 0), 0);

    return {
      revenue: summary.revenue + revenue,
      discounts: summary.discounts + Number(service.discount || 0),
      materialsSold: summary.materialsSold + materialsSold,
      materialCost: summary.materialCost + cost,
      grossProfit: summary.grossProfit + revenue - cost,
      received: summary.received + (service.payment_status === 'pago' ? revenue : 0),
      pending: summary.pending + (service.payment_status === 'pendente' ? revenue : 0),
    };
  }, { revenue: 0, discounts: 0, materialsSold: 0, materialCost: 0, grossProfit: 0, received: 0, pending: 0 });
}
