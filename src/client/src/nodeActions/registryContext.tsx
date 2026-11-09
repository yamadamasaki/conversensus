/**
 * 登録された module を画面へ降ろす (計画 N2)
 *
 * **core は module を import しない** (計画 §3.2・N4)。どの module を使うかは App の入口 (`main.tsx`) が
 * 決めて、ここに渡す。App 結合の試験は、試験用の module を同じ口から渡す。
 * 渡されなければ module は無い (操作も印も出ない)。
 */

import { createContext, type ReactNode, useContext } from 'react';
import { createNodeActionRegistry, type NodeActionRegistry } from './registry';

const NO_MODULES = createNodeActionRegistry([]);

const RegistryContext = createContext<NodeActionRegistry>(NO_MODULES);

export function NodeActionsProvider({
  registry,
  children,
}: {
  registry: NodeActionRegistry;
  children: ReactNode;
}) {
  return (
    <RegistryContext.Provider value={registry}>
      {children}
    </RegistryContext.Provider>
  );
}

export function useNodeActionRegistry(): NodeActionRegistry {
  return useContext(RegistryContext);
}
