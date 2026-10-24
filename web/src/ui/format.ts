export const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`
export const H2 = { fontSize: 14, color: '#aaa', margin: '12px 0 4px' }
