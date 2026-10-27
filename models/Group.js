const { DataTypes } = require('sequelize');

function defineGroup(sequelize) {
  return sequelize.define(
    'Group',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      uid: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      link: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      status: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'pending',
      },
      scannedAt: {
        type: DataTypes.BIGINT,
        allowNull: true,
        field: 'scanned_at',
      },
      claimedAt: {
        type: DataTypes.BIGINT,
        allowNull: true,
        field: 'claimed_at',
      },
      claimedBy: {
        type: DataTypes.STRING(64),
        allowNull: true,
        field: 'claimed_by',
      },
      availableAt: {
        type: DataTypes.BIGINT,
        allowNull: true,
        field: 'available_at',
      },
      lastStopReason: {
        type: DataTypes.STRING(64),
        allowNull: true,
        field: 'last_stop_reason',
      },
      note: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: 'groups',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );
}

module.exports = { defineGroup };
