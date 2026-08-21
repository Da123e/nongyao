from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey, Text
from sqlalchemy.orm import relationship
from datetime import datetime
from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    email = Column(String(100), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    real_name = Column(String(50))
    phone = Column(String(20))
    public_key = Column(Text)
    private_key = Column(Text)
    wallet_address = Column(String(42))
    organization_id = Column(Integer)
    organization_type = Column(String(20))
    is_active = Column(Boolean, default=True)
    is_superuser = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    roles = relationship("UserRole", back_populates="user")


class Role(Base):
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), unique=True, index=True, nullable=False)
    description = Column(String(200))
    role_type = Column(String(20), index=True)
    created_at = Column(DateTime, default=datetime.now)

    users = relationship("UserRole", back_populates="role")
    permissions = relationship("RolePermission", back_populates="role")


class Permission(Base):
    __tablename__ = "permissions"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, index=True, nullable=False)
    code = Column(String(50), unique=True, nullable=False)
    description = Column(String(200))
    module = Column(String(20))

    roles = relationship("RolePermission", back_populates="permission")


class UserRole(Base):
    __tablename__ = "user_roles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    role_id = Column(Integer, ForeignKey("roles.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.now)

    user = relationship("User", back_populates="roles")
    role = relationship("Role", back_populates="users")


class RolePermission(Base):
    __tablename__ = "role_permissions"

    id = Column(Integer, primary_key=True, index=True)
    role_id = Column(Integer, ForeignKey("roles.id"), nullable=False, index=True)
    permission_id = Column(Integer, ForeignKey("permissions.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.now)

    role = relationship("Role", back_populates="permissions")
    permission = relationship("Permission", back_populates="roles")


class Organization(Base):
    __tablename__ = "organizations"

    id = Column(Integer, primary_key=True, index=True)
    org_code = Column(String(50), unique=True, index=True, nullable=False)
    name = Column(String(100), nullable=False, index=True)
    type = Column(String(20), index=True)
    contact_name = Column(String(50))
    phone = Column(String(20))
    address = Column(String(200))
    public_key = Column(Text)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


class Certificate(Base):
    __tablename__ = "certificates"

    id = Column(Integer, primary_key=True, index=True)
    certificate_id = Column(String(100), unique=True, index=True, nullable=False)
    certificate_type = Column(String(20), nullable=False, index=True)
    subject_type = Column(String(20), nullable=False)
    subject_id = Column(Integer, nullable=False, index=True)
    issuer = Column(String(100), nullable=False)
    serial_number = Column(String(100), unique=True, nullable=False)
    public_key = Column(Text, nullable=False)
    private_key = Column(Text, nullable=False)
    certificate_data = Column(Text)
    status = Column(String(20), default="active", index=True)
    valid_from = Column(DateTime, nullable=False)
    valid_until = Column(DateTime, nullable=False)
    revoked_at = Column(DateTime)
    reason = Column(String(200))
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    type = Column(String(20), nullable=False, index=True)
    title = Column(String(100), nullable=False)
    message = Column(Text, nullable=False)
    read = Column(Boolean, default=False, index=True)
    created_at = Column(DateTime, default=datetime.now)

    user = relationship("User")
