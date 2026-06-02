export type ItemsSource =
  | 'personalized'
  | 'recent'
  | 'favorites'
  | 'downloads'
  | 'default-search'
  | 'convert'
  | 'worker'
  | 'empty';

export type ItemsResponse<T> = {
  items: T[];
  source: ItemsSource;
};

export const asItemsResponse = <T>(input: unknown, source: ItemsSource = 'personalized'): ItemsResponse<T> => {
  if (Array.isArray(input)) return { items: input as T[], source };
  if (input && typeof input === 'object' && Array.isArray((input as any).items)) {
    return { items: (input as any).items as T[], source: ((input as any).source as ItemsSource) || source };
  }
  return { items: [], source: 'empty' };
};
