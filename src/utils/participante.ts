// Mapeo unificado de Participante a DTO de salida
// Evita duplicar la lógica de nombre_visible / es_fantasma en controllers

import { Participante } from '@prisma/client';

export interface ParticipanteDTO {
  id: string;
  nombre_visible: string;
  es_fantasma: boolean;
  usuario_id: string | null;
  monto_consumido_centavos: number;
  monto_pagado_centavos: number;
}

export function mapearParticipante(p: Participante & {
  usuario?: { id: string; nombre: string; avatar_url: string | null } | null;
}): ParticipanteDTO {
  return {
    id: p.id,
    nombre_visible: p.usuario?.nombre ?? p.nombre_invitado ?? 'Invitado',
    es_fantasma: !p.usuario,
    usuario_id: p.usuario_id,
    monto_consumido_centavos: p.monto_consumido_centavos,
    monto_pagado_centavos: p.monto_pagado_centavos,
  };
}