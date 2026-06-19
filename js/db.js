/* ================================================================
   Real Molinos 3 — Base de datos local
   Sincroniza con Supabase via data.js
   ================================================================ */

const DB = {
  users: [],
  residents: [],
  payments: [],
  notifications: [],
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
      hours: ''
    },
    emergency: [
      { label: '911', number: '911', desc: 'Emergencias', color: 'red' },
      { label: '080', number: '080', desc: 'Bomberos',    color: 'blue' }
    ]
  },
  settings: {
    defaultFee: 400
  },
  nextId: 100
};
