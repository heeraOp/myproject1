from rest_framework.permissions import BasePermission, IsAdminUser, IsAuthenticated


def is_admin_user(user) -> bool:
    """
    Canonical admin check for API endpoints.
    Superusers are always allowed, then Django staff admins, then project ADMIN role.
    """
    if not user or not user.is_authenticated:
        return False
    if bool(getattr(user, "is_superuser", False)):
        return True
    if bool(getattr(user, "is_staff", False)):
        return True
    return getattr(user, "role", None) == "ADMIN"


class IsAdminRole(BasePermission):
    """
    Enforce authenticated admin access while remaining compatible with legacy role-based admins.
    Uses DRF built-ins for auth/staff checks and extends with role + superuser fallback.
    """

    message = "You do not have permission to perform this action."

    def has_permission(self, request, view):
        if not IsAuthenticated().has_permission(request, view):
            return False

        user = request.user
        if bool(getattr(user, "is_superuser", False)):
            return True

        if IsAdminUser().has_permission(request, view):
            return True

        return getattr(user, "role", None) == "ADMIN"
