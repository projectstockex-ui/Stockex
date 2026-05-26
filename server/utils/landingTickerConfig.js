/**
 * Landing page ticker strip — display labels and how to resolve instruments in Mongo.
 */

export const LANDING_TICKER_ITEMS = [
  { label: 'RELIANCE', symbols: ['RELIANCE'], exchanges: ['NSE'], instrumentTypes: ['STOCK', 'EQ'] },
  { label: 'TCS', symbols: ['TCS'], exchanges: ['NSE'], instrumentTypes: ['STOCK', 'EQ'] },
  { label: 'HDFCBANK', symbols: ['HDFCBANK'], exchanges: ['NSE'], instrumentTypes: ['STOCK', 'EQ'] },
  { label: 'INFY', symbols: ['INFY'], exchanges: ['NSE'], instrumentTypes: ['STOCK', 'EQ'] },
  { label: 'ICICIBANK', symbols: ['ICICIBANK'], exchanges: ['NSE'], instrumentTypes: ['STOCK', 'EQ'] },
  { label: 'NIFTY 50', symbols: ['NIFTY', 'NIFTY 50'], tokens: [256265, 99926000] },
  { label: 'BANKNIFTY', symbols: ['BANKNIFTY', 'NIFTY BANK', 'BANK NIFTY'], tokens: [260105, 99926009] },
  { label: 'SENSEX', symbols: ['SENSEX'], tokens: [265, 99919000] },
  { label: 'GOLD', symbols: ['GOLD'], exchanges: ['MCX'], mcxCommodity: true, excludeSymbols: ['GOLDM', 'GOLDGUINEA', 'GOLDPETAL'] },
  { label: 'CRUDE', symbols: ['CRUDEOIL', 'CRUDE'], exchanges: ['MCX'], mcxCommodity: true, excludeSymbols: ['CRUDEOILM'] },
  { label: 'USDINR', symbols: ['USDINR'], tokens: ['USDINR'], forex: true },
  { label: 'TATAMOTORS', symbols: ['TATAMOTORS', 'TMPV'], exchanges: ['NSE', 'BSE'], instrumentTypes: ['STOCK', 'EQ'] },
];

export default LANDING_TICKER_ITEMS;
