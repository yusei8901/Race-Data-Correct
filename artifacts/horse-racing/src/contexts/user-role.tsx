import { createContext, useContext, useState } from "react";

export type UserRole = "管理者" | "一般ユーザー";

interface UserRoleContextType {
  role: UserRole;
  setRole: (role: UserRole) => void;
  isAdmin: boolean;
}

const UserRoleContext = createContext<UserRoleContextType>({
  role: "管理者",
  setRole: () => {},
  isAdmin: true,
});

export function UserRoleProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<UserRole>("管理者");
  return (
    <UserRoleContext.Provider value={{ role, setRole, isAdmin: role === "管理者" }}>
      {children}
    </UserRoleContext.Provider>
  );
}

export function useUserRole() {
  return useContext(UserRoleContext);
}
