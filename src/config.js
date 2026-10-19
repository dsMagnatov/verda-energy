// Replace contact details here before connecting a real business inbox.
export const config = {
  brand: 'VERDA ENERGY',
  contactEmail: '',
  contactSubject: 'A cleaner future, together',
  storyViewports: 7,
  data: {
    powerMW: 4.2,
    windMS: 8.4,
    dailyMWh: 73.6,
    hours: ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', '24:00'],
    // Trapezoidal integral over these 4-hour samples is exactly 73.6 MWh.
    powerSamples: [1.8, 2.2, 2.9, 3.7, 4.2, 3.1, 2.8],
  },
};
