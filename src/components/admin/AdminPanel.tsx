import { useMemo, useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useAdminCreateUser,
  useAdminUpdateUser,
  useAppSettings,
  useProfiles,
  useTiStatusCounts,
  useUpdateAppSettings,
  type AppRole,
  type UserProfile,
} from "@/api-client";
import { useToast } from "@/hooks/use-toast";
import { ClipboardList, Clock3, ListChecks, Shield, UserPlus, XCircle } from "lucide-react";

const ROLES: AppRole[] = ["viewer", "user", "checker", "admin"];

export function AdminPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const { data: profiles = [], isFetching } = useProfiles({ query: { enabled: open } });
  const { data: settings } = useAppSettings({ query: { enabled: open } });
  const { data: statusCounts = { all: 0, pending_check: 0, checked: 0, rejected: 0 } } = useTiStatusCounts({ query: { enabled: open } });
  const createUser = useAdminCreateUser();
  const updateUser = useAdminUpdateUser();
  const updateSettings = useUpdateAppSettings();

  const [newUser, setNewUser] = useState({
    email: "",
    password: "",
    full_name: "",
    role: "user" as AppRole,
    is_active: true,
  });

  const adminProfiles = useMemo(
    () => profiles.filter((profile) => profile.role === "admin" && profile.is_active),
    [profiles]
  );

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await createUser.mutateAsync(newUser);
      setNewUser({ email: "", password: "", full_name: "", role: "user", is_active: true });
      toast({ title: "User created" });
    } catch (error) {
      toast({ variant: "destructive", title: "User creation failed", description: String(error) });
    }
  };

  const handleUpdate = async (profile: UserProfile, patch: Partial<UserProfile> & { password?: string }) => {
    try {
      await updateUser.mutateAsync({
        id: profile.id,
        full_name: patch.full_name,
        role: patch.role,
        is_active: patch.is_active,
        password: patch.password,
      });
      toast({ title: "User updated" });
    } catch (error) {
      toast({ variant: "destructive", title: "Update failed", description: String(error) });
    }
  };

  const handleDefaultApproverChange = async (userId: string) => {
    try {
      await updateSettings.mutateAsync({
        data: { default_approver_user_id: userId || null },
      });
      toast({ title: "Default approver updated" });
    } catch (error) {
      toast({ variant: "destructive", title: "Setting update failed", description: String(error) });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl h-[88vh] flex flex-col p-0 overflow-hidden border-gray-200 shadow-2xl">
        <DialogHeader className="px-7 py-5 border-b border-gray-200 bg-white">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-[#eef4ff] text-[#2a4080] flex items-center justify-center">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-xl text-[#20366f]">Admin Panel</DialogTitle>
              <p className="text-sm text-gray-500 mt-0.5">Manage users, roles, and TI approval settings.</p>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto bg-[#f7f9fc] p-6 space-y-6">
          <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <StatusCountCard icon={<ClipboardList />} label="All TI" count={statusCounts.all} tone="blue" />
            <StatusCountCard icon={<Clock3 />} label="Created" count={statusCounts.pending_check} tone="amber" />
            <StatusCountCard icon={<ListChecks />} label="Checked" count={statusCounts.checked} tone="green" />
            <StatusCountCard icon={<XCircle />} label="Rejected" count={statusCounts.rejected} tone="red" />
          </section>

          <section className="bg-white border border-gray-200 rounded-md p-5 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-end gap-4">
              <div className="flex-1">
                <Label className="text-xs uppercase text-gray-500">Default Approver</Label>
                <select
                  value={settings?.default_approver_user_id || ""}
                  onChange={(event) => handleDefaultApproverChange(event.target.value)}
                  className="mt-1 h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-800 outline-none focus:border-[#4a6fa5] focus:ring-2 focus:ring-[#4a6fa5]/15"
                >
                  <option value="">Select active admin...</option>
                  {adminProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.full_name} ({profile.initials})
                    </option>
                  ))}
                </select>
              </div>
              <p className="max-w-xl text-sm text-gray-600">
                When a TI is checked, Approved By is filled automatically from this admin.
              </p>
            </div>
          </section>

          <section className="bg-white border border-gray-200 rounded-md p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-4 text-[#20366f] font-bold">
              <UserPlus className="w-5 h-5" />
              Create User
            </div>
            <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-6 gap-4 items-end">
              <AdminField label="Full Name" value={newUser.full_name}
                onChange={(value) => setNewUser((current) => ({ ...current, full_name: value }))} />
              <AdminField label="Email" type="email" value={newUser.email}
                onChange={(value) => setNewUser((current) => ({ ...current, email: value }))} />
              <AdminField label="Password" type="password" value={newUser.password}
                onChange={(value) => setNewUser((current) => ({ ...current, password: value }))} />
              <div>
                <Label className="text-xs uppercase text-gray-500">Role</Label>
                <RoleSelect
                  value={newUser.role}
                  onChange={(role) => setNewUser((current) => ({ ...current, role }))}
                />
              </div>
              <label className="flex items-center gap-2 h-10 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={newUser.is_active}
                  onChange={(event) => setNewUser((current) => ({ ...current, is_active: event.target.checked }))}
                />
                Active
              </label>
              <Button type="submit" disabled={createUser.isPending} className="bg-[#2a4080] hover:bg-[#1f3164]">
                {createUser.isPending ? "Creating..." : "Create"}
              </Button>
            </form>
          </section>

          <section className="bg-white border border-gray-200 rounded-md shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-bold text-[#20366f]">Users</h3>
              <span className="text-sm text-gray-500">{isFetching ? "Loading..." : `${profiles.length} user(s)`}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#456da8] text-white">
                  <tr>
                    <th className="text-left px-4 py-3">Name</th>
                    <th className="text-left px-4 py-3">Email</th>
                    <th className="text-left px-4 py-3">Initials</th>
                    <th className="text-left px-4 py-3">Role</th>
                    <th className="text-left px-4 py-3">Active</th>
                    <th className="text-left px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {profiles.map((profile) => (
                    <UserRow
                      key={profile.id}
                      profile={profile}
                      onUpdate={handleUpdate}
                      isSaving={updateUser.isPending}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className="flex justify-end px-6 py-4 border-t border-gray-200 bg-white">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StatusCountCard({
  icon,
  label,
  count,
  tone,
}: {
  icon: ReactNode;
  label: string;
  count: number;
  tone: "blue" | "amber" | "green" | "red";
}) {
  const tones = {
    blue: "bg-blue-50 text-blue-800 border-blue-100",
    amber: "bg-amber-50 text-amber-800 border-amber-100",
    green: "bg-emerald-50 text-emerald-800 border-emerald-100",
    red: "bg-red-50 text-red-800 border-red-100",
  };

  return (
    <div className={`rounded-md border p-4 shadow-sm ${tones[tone]}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide opacity-75">{label}</div>
          <div className="mt-1 text-2xl font-bold">{count}</div>
        </div>
        <div className="[&>svg]:h-6 [&>svg]:w-6 opacity-80">{icon}</div>
      </div>
    </div>
  );
}

function AdminField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <div>
      <Label className="text-xs uppercase text-gray-500">{label}</Label>
      <Input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-10"
        required
      />
    </div>
  );
}

function RoleSelect({ value, onChange }: { value: AppRole; onChange: (role: AppRole) => void }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as AppRole)}
      className="mt-1 h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-800 outline-none focus:border-[#4a6fa5] focus:ring-2 focus:ring-[#4a6fa5]/15"
    >
      {ROLES.map((role) => (
        <option key={role} value={role}>
          {role}
        </option>
      ))}
    </select>
  );
}

function UserRow({
  profile,
  onUpdate,
  isSaving,
}: {
  profile: UserProfile;
  onUpdate: (profile: UserProfile, patch: Partial<UserProfile> & { password?: string }) => Promise<void>;
  isSaving: boolean;
}) {
  const [fullName, setFullName] = useState(profile.full_name);
  const [role, setRole] = useState<AppRole>(profile.role);
  const [isActive, setIsActive] = useState(profile.is_active);
  const [password, setPassword] = useState("");

  return (
    <tr className="odd:bg-white even:bg-gray-50/40">
      <td className="px-4 py-3 min-w-[190px]">
        <Input value={fullName} onChange={(event) => setFullName(event.target.value)} className="h-9" />
      </td>
      <td className="px-4 py-3 min-w-[220px] text-gray-700">{profile.email}</td>
      <td className="px-4 py-3 font-semibold text-[#2a4080]">{profile.initials}</td>
      <td className="px-4 py-3 min-w-[130px]">
        <RoleSelect value={role} onChange={setRole} />
      </td>
      <td className="px-4 py-3">
        <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
      </td>
      <td className="px-4 py-3 min-w-[230px]">
        <div className="flex items-center gap-2">
          <Input
            type="password"
            placeholder="New password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="h-9 w-32"
          />
          <Button
            type="button"
            size="sm"
            disabled={isSaving}
            onClick={() => {
              onUpdate(profile, {
                full_name: fullName,
                role,
                is_active: isActive,
                password: password || undefined,
              }).then(() => setPassword(""));
            }}
            className="bg-[#2a4080] hover:bg-[#1f3164]"
          >
            Save
          </Button>
        </div>
      </td>
    </tr>
  );
}
