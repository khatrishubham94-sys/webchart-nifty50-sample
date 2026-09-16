export type OptionsSelection = {
  symbol: string;
  instrument: "STO" | "STF" | "IDO" | "IDF";
  expiry: string;
  strike: number | null;
  optionType: "CE" | "PE" | null;
};
