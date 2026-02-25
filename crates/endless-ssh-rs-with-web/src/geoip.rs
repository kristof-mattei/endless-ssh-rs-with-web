use std::net::IpAddr;
use std::path::{Path, PathBuf};

use http::HeaderMap;
use http::header::ETAG;
use maxminddb::{Mmap, geoip2};
use memmap2::MmapOptions;
use thiserror::Error;
use tracing::{Level, event};

#[derive(Error, Debug)]
enum MmapError {
    #[error("I/O error: {0}")]
    Io(
        #[from]
        #[source]
        std::io::Error,
    ),
    #[error("File lock error: {0}")]
    TryLockError(
        #[from]
        #[source]
        std::fs::TryLockError,
    ),
}

#[derive(Debug, Clone)]
pub struct GeoInfo {
    /// Two-character ISO 3166-1 alpha-2 country code. See <https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2>.
    pub country_code: Option<String>,
    pub country_name: Option<String>,
    pub city: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
}

const GEO_IP_PATH: &str = "./.local/ip-database/GeoLite2-City.mmdb";

pub struct GeoIpReader {
    db: maxminddb::Reader<Mmap>,
}

pub async fn try_init(license_key: &str) -> Option<GeoIpReader> {
    // TODO exponential back-off
    for _ in 0..5 {
        // TODO print try number
        if let Some(geo_ip_reader) = GeoIpReader::init(license_key).await {
            return Some(geo_ip_reader);
        } else {
            let geo_ip_path = Path::new(GEO_IP_PATH);
            // remove files so that the download will trigger again
            if let Err(db_removal) = std::fs::remove_file(geo_ip_path) {
                event!(
                    Level::ERROR,
                    ?db_removal,
                    path = %geo_ip_path.display(),
                    "Failed to delete the GeoLite2 database"
                );
            }
            if let Err(etag_removal) = std::fs::remove_file(geo_ip_path.with_extension("etag")) {
                event!(
                    Level::ERROR,
                    ?etag_removal,
                    path = %geo_ip_path.with_extension("etag").display(),
                    "Failed to delete the GeoLite2 ETAG file"
                );
            }
        }
    }

    None
}

impl GeoIpReader {
    pub async fn init(license_key: &str) -> Option<GeoIpReader> {
        let geo_ip_path = Path::new(GEO_IP_PATH);

        // create directory structure to where we'll write the file, this doesn't fail if they already exist
        if let Some(parent) = geo_ip_path.parent() {
            if let Err(error) = std::fs::create_dir_all(parent) {
                event!(Level::ERROR, ?error, structure = %parent.display(), "Failed to create directory structure, writing the file will probably fail");
            }
        }

        // do we have a file?
        if should_download_database(license_key, geo_ip_path).await {
            // We don't, try and download
            if let Err(error) = download_database(license_key, geo_ip_path.to_path_buf()).await {
                event!(Level::ERROR, ?error, "Failed to download GeoLite2 database");

                return None;
            }
        } else {
            event!(Level::INFO, "GeoLite2 database up to date");
        }

        // we now have file, let's try and memory map it
        let mmap = match try_mmap_file(geo_ip_path) {
            Ok(mapped_file) => mapped_file,
            Err(error) => {
                event!(Level::ERROR, ?error, database_path = ?geo_ip_path.display(), "Fialed to open database as mmap");

                return None;
            },
        };

        // let's try to read our memory mapped file
        match maxminddb::Reader::from_source(mmap) {
            Ok(reader) => {
                event!(Level::INFO, geoip_path = %geo_ip_path.display(), "Loaded GeoLite2 database");

                Some(GeoIpReader { db: reader })
            },
            Err(error) => {
                event!(
                    Level::WARN,
                    ?error,
                    "Failed to parse cached GeoLite2 database"
                );

                None
            },
        }
    }

    pub fn lookup(&self, ip: IpAddr) -> Option<GeoInfo> {
        let city: geoip2::City<'_> = self.db.lookup(ip).ok()?.decode::<geoip2::City>().ok()??;

        let country_code = city.country.iso_code.map(str::to_owned);

        let country_name = city.country.names.english.map(|s| (*s).to_owned());

        let city_name = city.city.names.english.map(|s| (*s).to_owned());

        let latitude = city.location.latitude;
        let longitude = city.location.longitude;

        Some(GeoInfo {
            country_code,
            country_name,
            city: city_name,
            latitude,
            longitude,
        })
    }

    // TODO create replacer task
}

async fn should_download_database(license_key: &str, geo_ip_path: &Path) -> bool {
    let exists = std::fs::exists(geo_ip_path).is_ok_and(|verified_to_exist| verified_to_exist);

    if !exists {
        return true;
    }

    let etag_file = geo_ip_path.with_extension("etag");

    // file exists, verify existance of etag file
    let etag = match std::fs::read_to_string(&etag_file) {
        Ok(contents) => contents,
        Err(error) => {
            event!(
                Level::ERROR,
                ?error,
                path = %etag_file.display(),
                "Failed to check etag file"
            );

            return false;
        },
    };

    match get_database_etag(license_key).await {
        Ok(server_etag) => {
            // if they're different, yes, download the file
            server_etag != etag
        },
        Err(_error) => false,
    }
}

fn get_etag(headers: &HeaderMap) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let etag = headers
        .get(ETAG)
        .map(|etag| etag.to_str().map(ToOwned::to_owned));

    let Some(etag) = etag else {
        event!(Level::ERROR, "No ETAG present on request");

        return Err("No ETAG present on response".into());
    };

    match etag {
        Ok(etag) => Ok(etag),
        Err(ref error) => {
            event!(Level::ERROR, ?error, etag = ?etag, "ETAG on response not valid ASCII");

            Err("ETAG on response not valid ASCII".into())
        },
    }
}

fn build_url(license_key: &str) -> url::Url {
    let mut url: url::Url =
        "https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-City&suffix=tar.gz"
            .parse()
            .expect("Start URL is always valid");

    url.query_pairs_mut()
        .append_pair("license_key", license_key);

    url
}

async fn get_database_etag(
    license_key: &str,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let url = build_url(license_key);

    event!(Level::INFO, "Checking GeoLite2-City's latest ETAG...");

    let response = reqwest::Client::new().head(url).send().await?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()).into());
    }

    let headers = response.headers();

    get_etag(headers)
}

async fn download_database(
    license_key: &str,
    output: PathBuf,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let url = build_url(license_key);

    event!(Level::INFO, "Downloading GeoLite2-City database...");

    let response = reqwest::Client::new().get(url).send().await?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()).into());
    }

    // write the ETAG
    let etag = get_etag(response.headers())?;
    std::fs::write(output.with_extension("etag"), etag)?;

    let bytes = response.bytes().await?;

    // decompress the gz, walk through the tar until we find the entry, and write it to the output file
    tokio::task::spawn_blocking(move || {
        use flate2::read::GzDecoder;

        let decoder = GzDecoder::new(bytes.as_ref());
        let mut archive = tar::Archive::new(decoder);

        for entry in archive.entries()? {
            let mut entry = entry?;
            let path = entry.path()?.into_owned();
            if path.extension().is_some_and(|ext| ext == "mmdb") {
                let _r = entry.unpack(output)?;

                return Result::<(), Box<dyn std::error::Error + Send + Sync>>::Ok(());
            }
        }

        Err("GeoLite2-City.mmdb not found in downloaded archive".into())
    })
    .await??;

    Ok(())
}

fn try_mmap_file(path: &Path) -> Result<Mmap, MmapError> {
    let file_read = std::fs::File::open(path).map_err(|error| {
        event!(
            Level::WARN,
            ?error,
            path = %path.display(),
            "No cached GeoLite2 database found"
        );

        MmapError::from(error)
    })?;

    if let Err(error) = file_read.try_lock() {
        event!(
            Level::ERROR,
            ?error,
            path = %path.display(),
            "Could not gain exclusive lock on file"
        );

        return Err(MmapError::from(error));
    }

    // SAFETY: we take an advisory lock.
    // we should probably run as our own user
    Ok(unsafe { MmapOptions::new().map(&file_read) }?)
}
