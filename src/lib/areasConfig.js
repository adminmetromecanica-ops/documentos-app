// Mapea cada área a su carpeta real en MinIO y los tipos de documento que maneja.
// Si agregas un tipo de documento nuevo, solo actualiza esto — no hay que tocar nada más.

export const AREAS_CONFIG = {
  laboratorio: {
    label: 'Laboratorio',
    carpeta: 'Laboratorio',
    tipos: [
      { value: 'certificado', label: 'Certificado', subcarpeta: 'Certificados' },
      { value: 'trazabilidad', label: 'Trazabilidad', subcarpeta: 'Trazabilidades' },
      { value: 'conformidad_servicio', label: 'Conformidad de Servicio', subcarpeta: 'Conformidad_Servicio' },
      { value: 'informe_mantenimiento', label: 'Informe de Mantenimiento', subcarpeta: 'Informe_Mantenimiento' },
    ],
  },
  contabilidad: {
    label: 'Contabilidad',
    carpeta: 'Contabilidad',
    tipos: [
      { value: 'factura', label: 'Factura', subcarpeta: 'Factura' },
      { value: 'comprobante_pago', label: 'Comprobante de Pago', subcarpeta: 'Comprobante_Pago' },
      { value: 'nota_credito', label: 'Nota de Crédito', subcarpeta: 'Nota_Credito' },
      { value: 'detraccion', label: 'Detracción', subcarpeta: 'Detraccion' },
    ],
  },
  comercial: {
    label: 'Comercial',
    carpeta: 'Comercial',
    tipos: [
      { value: 'orden_trabajo', label: 'Orden de Trabajo', subcarpeta: 'Orden_Trabajo' },
      { value: 'orden_compra', label: 'Orden de Compra', subcarpeta: 'Orden_Compra' },
      { value: 'proforma', label: 'Proforma', subcarpeta: 'Proforma' },
    ],
  },
  logistica: {
    label: 'Logística',
    carpeta: 'Logistica',
    tipos: [
      { value: 'guia_recojo', label: 'Guía de Recojo', subcarpeta: 'Recepcion/Guia_Recojo' },
      { value: 'guia_traslado', label: 'Guía de Traslado', subcarpeta: 'Recepcion/Guia_Traslado' },
      { value: 'foto_ingreso', label: 'Foto de Ingreso', subcarpeta: 'Recepcion/Fotos' },
      // Se mantienen por compatibilidad con documentos ya subidos con estos tipos:
      { value: 'guia_ingreso', label: 'Guía de Ingreso (antiguo)', subcarpeta: 'Recepcion/Guias' },
      { value: 'cargo_entrega', label: 'Cargo de Entrega', subcarpeta: 'Entrega/Cargo' },
      { value: 'acta_conformidad', label: 'Acta de Conformidad', subcarpeta: 'Entrega/Acta_Conformidad' },
    ],
  },
}

// Gerencia ve todas las áreas -> se arma dinámicamente
export const TODAS_LAS_AREAS = Object.keys(AREAS_CONFIG)