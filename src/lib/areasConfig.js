// Mapea cada área a su carpeta real en MinIO y los tipos de documento que maneja.
// Si agregas un tipo de documento nuevo, solo actualiza esto — no hay que tocar nada más.

export const AREAS_CONFIG = {
  laboratorio: {
    label: 'Laboratorio',
    carpeta: 'Laboratorio',
    tipos: [
      { value: 'certificado', label: 'Certificado', subcarpeta: 'Certificados' },
      { value: 'trazabilidad', label: 'Trazabilidad', subcarpeta: 'Trazabilidades' },
    ],
  },
  contabilidad: {
    label: 'Contabilidad',
    carpeta: 'Contabilidad',
    tipos: [
      { value: 'factura', label: 'Factura', subcarpeta: 'Factura' },
      { value: 'comprobante_pago', label: 'Comprobante de Pago', subcarpeta: 'Comprobante_Pago' },
    ],
  },
  comercial: {
    label: 'Comercial',
    carpeta: 'Comercial',
    tipos: [
      { value: 'proforma', label: 'Proforma', subcarpeta: 'Proforma' },
      { value: 'orden_compra', label: 'Orden de Compra', subcarpeta: 'Orden_Compra' },
    ],
  },
  logistica: {
    label: 'Logística',
    carpeta: 'Logistica',
    tipos: [
      { value: 'guia_ingreso', label: 'Guía de Ingreso', subcarpeta: 'Recepcion/Guias' },
      { value: 'foto_ingreso', label: 'Foto de Ingreso', subcarpeta: 'Recepcion/Fotos' },
      { value: 'cargo_entrega', label: 'Cargo de Entrega', subcarpeta: 'Entrega/Cargo' },
      { value: 'acta_conformidad', label: 'Acta de Conformidad', subcarpeta: 'Entrega/Acta_Conformidad' },
    ],
  },
}

// Gerencia ve todas las áreas -> se arma dinámicamente
export const TODAS_LAS_AREAS = Object.keys(AREAS_CONFIG)
