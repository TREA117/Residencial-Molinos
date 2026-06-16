/* ================================================================
   Real Molinos 3 — Base de datos local
   Sincroniza con Supabase via data.js
   ================================================================ */

const DB = {
  users: [],
  residents: [],
  payments: [],
  finances: [],
  contacts: {
    admin: {
      name: 'Administración Real Molinos 3',
      phone1: { number: '+525512345678', label: 'Línea principal', display: '+52 55 1234 5678' },
      phone2: { number: '+525587654321', label: 'Celular administrador', display: '+52 55 8765 4321' },
      whatsapp: '+525587654321',
      email: 'admin@realmolinos3.com',
      hours: 'Lun–Vie 9:00–18:00 · Sáb 9:00–13:00'
    },
    caseta: {
      name: 'Caseta de Seguridad',
      phone1: { number: '+525511112222', label: 'Línea directa caseta', display: '+52 55 1111 2222' },
      phone2: { number: '+525533334444', label: 'Celular guardia', display: '+52 55 3333 4444' },
      whatsapp: '+525533334444',
      hours: 'Servicio activo las 24 horas, los 365 días'
    },
    emergency: [
      { label: '911',              number: '911',           desc: 'Emergencias',     color: 'red' },
      { label: '080',              number: '080',           desc: 'Bomberos',         color: 'blue' },
      { label: '+52 55 5555 5555', number: '+525555555555', desc: 'Plomería urgente', color: 'green' },
      { label: '+52 55 6666 7777', number: '+525566667777', desc: 'Electricidad',     color: 'amber' }
    ]
  },
  nextId: 100
};
