const { DataTypes } = require('sequelize');

function defineActivityLog(sequelize) {
  return sequelize.define(
    'ActivityLog',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      type: {
        type: DataTypes.STRING(32),
        allowNull: false,
      },
      action: {
        type: DataTypes.STRING(32),
        allowNull: false,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'user_id',
      },
      username: {
        type: DataTypes.STRING(64),
        allowNull: false,
        defaultValue: '',
      },
      summary: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
      },
      detailJson: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: 'detail_json',
      },
    },
    {
      tableName: 'activity_logs',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );
}

module.exports = { defineActivityLog };
