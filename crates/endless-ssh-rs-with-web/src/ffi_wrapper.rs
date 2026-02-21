use std::io::Error;
use std::mem::size_of_val;
use std::os::unix::prelude::AsRawFd as _;

use libc::{SO_RCVBUF, SOL_SOCKET, c_int, c_void, setsockopt, socklen_t};
use tokio::net::TcpStream;

pub fn set_receive_buffer_size(tcp_stream: &TcpStream, size_in_bytes: usize) -> Result<(), Error> {
    // Set the smallest possible recieve buffer. This reduces local
    // resource usage and slows down the remote end.
    let value: i32 = i32::try_from(size_in_bytes).expect("Byte buffer didn't fit in an i32");

    let size: socklen_t = u32::try_from(size_of_val(&value)).unwrap();

    // SAFETY: external call
    let r: c_int = unsafe {
        setsockopt(
            tcp_stream.as_raw_fd(),
            SOL_SOCKET,
            SO_RCVBUF,
            (&raw const value).cast::<c_void>(),
            size,
        )
    };

    if r == -1 {
        return Err(Error::last_os_error());
    }

    Ok(())
}
