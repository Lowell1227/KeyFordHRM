export type BusinessListVariant = 'record' | 'workflow' | 'split-master';

export type BusinessDrawerVariant = 'standard' | 'workflow' | 'wide';

export type DrawerBeforeClose = (done: () => void) => void;
