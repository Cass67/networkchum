on run argv
  if (count of argv) > 0 then
    my handleUrl(item 1 of argv)
  end if
end run

on open location targetUrl
  my handleUrl(targetUrl)
end open location

on handleUrl(targetUrl)
  set AppleScript's text item delimiters to "?"
  set urlParts to text items of targetUrl
  if (count of urlParts) < 2 then error "Invalid URL"

  set basePart to item 1 of urlParts
  set queryPart to item 2 of urlParts

  if basePart is not "networkchum://open-console" then error "Invalid route"

  set terminalName to my queryValue(queryPart, "terminal")
  set hostName to my queryValue(queryPart, "host")
  set portValue to my queryValue(queryPart, "port")

  if terminalName is not "iterm" then error "Unsupported terminal"
  if hostName is not "127.0.0.1" and hostName is not "localhost" then error "Unsupported host"
  set portNumber to portValue as integer
  if portNumber < 1 or portNumber > 65535 then error "Invalid port"

  set commandText to "/usr/local/bin/telnet " & hostName & space & portValue

  tell application "iTerm"
    activate
    create window with default profile
    tell current session of current window
      write text commandText
    end tell
  end tell
end handleUrl

on queryValue(queryText, keyName)
  set AppleScript's text item delimiters to "&"
  set queryItems to text items of queryText
  repeat with queryItem in queryItems
    set AppleScript's text item delimiters to "="
    set pairItems to text items of (contents of queryItem)
    if (count of pairItems) is 2 then
      if item 1 of pairItems is keyName then
        return item 2 of pairItems
      end if
    end if
  end repeat
  error "Missing query parameter: " & keyName
end queryValue
