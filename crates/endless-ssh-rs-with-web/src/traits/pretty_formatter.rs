use std::fmt::{Debug, Display};

#[expect(unused, reason = "Library code")]
pub fn pretty_format<T, E>(t: &Result<T, E>, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result
where
    T: Display,
    E: Debug,
{
    match *t {
        Ok(ref value) => write!(f, "{}", value),
        Err(ref error) => write!(f, "{:?}", error),
    }
}
