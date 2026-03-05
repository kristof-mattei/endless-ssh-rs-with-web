use std::net::IpAddr;

use ipnet::IpNet;
use sqlx::encode::IsNull;
use sqlx::error::BoxDynError;
use sqlx::postgres::types::PgInterval;
use sqlx::postgres::{PgArgumentBuffer, PgTypeInfo, PgValueRef};
use sqlx::{Decode, Encode, Postgres, Type};
use time::{Duration, OffsetDateTime};

use crate::db::conversions::{to_duration, to_inet, to_interval};

#[derive(Copy, Clone)]
pub enum Limit {
    Limit(i64),
    #[expect(unused, reason = "Not found a purpose yet")]
    All,
}

impl Type<Postgres> for Limit {
    fn type_info() -> PgTypeInfo {
        <i64 as Type<Postgres>>::type_info()
    }
}

impl Encode<'_, Postgres> for Limit {
    fn encode_by_ref(&self, buf: &mut PgArgumentBuffer) -> Result<IsNull, BoxDynError> {
        match *self {
            Limit::Limit(l) => <i64 as Encode<Postgres>>::encode(l, buf),
            Limit::All => {
                // Postgres interprets LIMIT NULL as LIMIT ALL
                Ok(IsNull::Yes)
            },
        }
    }
}

#[derive(Debug, Clone)]
pub struct DbIpAddr(pub IpAddr);

impl Type<Postgres> for DbIpAddr {
    fn type_info() -> PgTypeInfo {
        <IpNet as Type<Postgres>>::type_info()
    }
}

impl<'r> Decode<'r, Postgres> for DbIpAddr {
    fn decode(
        value: PgValueRef<'r>,
    ) -> Result<Self, Box<dyn std::error::Error + 'static + Send + Sync>> {
        // Decode into the native sqlx type first
        let ip_net = <IpNet as Decode<'r, Postgres>>::decode(value)?;
        // Convert and wrap
        Ok(DbIpAddr(ip_net.addr()))
    }
}

impl Encode<'_, Postgres> for DbIpAddr {
    fn encode_by_ref(&self, buf: &mut PgArgumentBuffer) -> Result<IsNull, BoxDynError> {
        <IpNet as Encode<Postgres>>::encode(to_inet(self.0), buf)
    }
}

impl From<DbIpAddr> for IpAddr {
    fn from(value: DbIpAddr) -> Self {
        value.0
    }
}

#[derive(Debug, Clone)]
pub struct DbDuration(pub Duration);

impl Type<Postgres> for DbDuration {
    fn type_info() -> PgTypeInfo {
        <PgInterval as Type<Postgres>>::type_info()
    }
}

impl<'r> Decode<'r, Postgres> for DbDuration {
    fn decode(
        value: PgValueRef<'r>,
    ) -> Result<Self, Box<dyn std::error::Error + 'static + Send + Sync>> {
        let interval = <PgInterval as Decode<'r, Postgres>>::decode(value)?;
        Ok(DbDuration(to_duration(interval)))
    }
}

impl Encode<'_, Postgres> for DbDuration {
    fn encode_by_ref(&self, buf: &mut PgArgumentBuffer) -> Result<IsNull, BoxDynError> {
        <PgInterval as Encode<Postgres>>::encode(to_interval(self.0), buf)
    }
}

impl From<DbDuration> for Duration {
    fn from(value: DbDuration) -> Self {
        value.0
    }
}

/// Raw connection record.
#[derive(Debug, Clone)]
pub struct ConnectionRecord {
    pub id: i64,
    pub ip_address: DbIpAddr,
    pub connected_at: OffsetDateTime,
    pub disconnected_at: OffsetDateTime,
    pub time_spent: DbDuration,
    pub bytes_sent: i64,
    // TODO narrow to 2 characters maybe?
    pub country_code: Option<String>,
    pub country_name: Option<String>,
    pub city: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
}
