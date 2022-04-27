/**
 * Author: Soumit Srimany
 * Email: soumit.srim@gmail.com
 * 
 * The aim of this module is to provide
 * functions for parsing (slightly modified version) 
 * of HTML.
 */

class PreNode {
  toIndentTree(str, indentCount = 0) {
    let indent = ''
    for (let i = 0; i < indentCount; ++i) { indent += ' ' }
    if (this.nodeType === 'text') {
      return `${indent}${str &&
        str.substring(this.tokens.at(0).start.index, this.tokens.at(-1).end.index + 1) ||
        this.value
        }`
    } else if (this.nodeType === 'element') {
      return `${indent}<${this.tagName}>\n` + this.childNodes.reduce((s, n) => s + n.toIndentTree(str, indentCount + 2) + '\n', '')
    }
  }

  getAttributes() {
    return this.openerTag && this.openerTag.attrs
  }
}

// All singleton tags (tags that donot require
// an ending markup) in HTML.
const OPENER_ONLY_TAGS = [
  "area", 
  "base", 
  "br", 
  "col", 
  "command", 
  "embed", 
  "hr", 
  "img", 
  "input", 
  "keygen", 
  "link", 
  "meta", 
  "param", 
  "source", 
  "track", 
  "wbr", 
]

class AttrList extends Array {

  // Adds an attribute only when the an attrbiute with
  // the given name is not present.
  add(attr) {
    if (!this.get(attr.name)) {
      this.push(attr)
    }
  }

  // Returns the attribute with the given name if present,
  // otherwise it returns undefined.
  get(name) {
    return this.find(a => a.name == name && a)
  }

  extractLoomsByName(name) {
    return Object.assign(new AttrList(), this.filter(a => {
      return a.nameTokens.length > 1 && a.nameTokens[0].value === '-' && a.nameTokens[1].value == name
    }))
  }
}

function findStringEnd(str, i) {
  let quote = str[i++]
  for (let l = str.length; i < l; ++i) {
    const ch = str[i]
    if (ch == '\\') {
      // Escape the next character.
      ++i
    } else if (ch == quote) {
      return i
    } else if (ch == '\n') {
      return i
    }
  }
  return -1
}

function tokenize(str, i = 0, row = 1, col = 1) {
  let tokens = []
  let prevStart = i, prevCol = row, prevRow = col

  for (let l = str.length; i < l; ++i, ++col) {
    let ch = str[i]

    if (ch == '\n') {
      prevStart = i + 1
      prevRow = ++row
      prevCol = col = 0
    } else if (ch == '"' || ch == "'") { // Single-Line string literal.

      // Add the previous token.
      if (i != prevStart) {
        tokens.push({
          start: { index: prevStart, row: prevRow, col: prevCol },
          end: { index: i, row: row, col: col },
          value: str.substring(prevStart, i)
        })
      }

      let end = findStringEnd(str, i)
      if (end == -1) {
        throw `failed to find end of string starting at row: ${row}, col: ${col}`
      } else if (str[end] == '\n') {
        throw `string starting at row: ${row}, col: ${col} leaks into the next line. (May be you are looking for multiline string).`
      }

      // Add the string token.
      tokens.push({
        start: { index: i, row: row, col: col },
        end: { index: end + 1, row: row, col: col + end - i + 1 },
        value: str.substring(i, end + 1)
      })

      col += end - i
      i = end

      prevStart = i + 1
      prevRow = row
      prevCol = col + 1
    } else if (ch == '`') { // Multi-line string literal.

      // TODO.........

    } else if (!ch.match(/[a-zA-Z0-9]/)) {
      // Add previous token.
      if (i != prevStart) {
        tokens.push({
          start: { index: prevStart, row: prevRow, col: prevCol },
          end: { index: i, row: row, col: col },
          value: str.substring(prevStart, i)
        })
      }

      // Add the current character only when it
      // is not a space character.
      if (ch.trim() != '') {
        if (tokens.length && tokens.at(-1).end.index == i &&
          ['{%', '{?', '{*', '*}', '?}', '%}'].find(k => tokens.at(-1).value + ch == k)) {
          let prevToken = tokens.at(-1)
          prevToken.end.index = i + 1
          prevToken.end.col++
          prevToken.end.row++
          prevToken.value += ch
        } else {
          tokens.push({
            start: { index: i, row: row, col: col },
            end: { index: i + 1, row: row, col: col + 1 },
            value: ch
          })
        }
      }

      prevStart = i + 1
      prevCol = col + 1
    } else if (i + 1 == l) {
      // When the value of 'i' has reached the last valid index for
      // the string i.e the difference between length of the string 
      // 'l' and 'i' is equal to 1.
      tokens.push({
        start: { index: prevStart, row: prevRow, col: prevCol },
        end: { index: i, row: row, col: col + 1 },
        value: str.substring(prevStart, i + 1)
      })
    }
  }
  return tokens
}

function isOpener(v) {
  return ['{', '{*', '{?', '{%', '(', '['].find(k => k == v) && true
}

function findBracketEnd(tokens, s) {
  let openers = ['{', '{*', '{%', '{?', '(', '[']
  let closers = ['}', '*}', '%}', '?}', ')', ']']

  let opener = tokens[s]
  let closerBracket = closers[openers.findIndex(e => e == opener.value)]

  let i = s + 1, l = tokens.length

  for (; i < l; ++i) {
    let token = tokens[i]
    let v = token.value
    if (v == closerBracket) {
      break
    } else if (openers.find(k => k == v)) {
      if ((i = findBracketEnd(tokens, i)) == -1) {
        return i;
      }
    }
  }

  return i >= l ? -1 : i
}

// Extracts a tag from the string 'str'.
// 'i' is the index of the opener diamond bracket
// <div class="hello">
// ^
// i  
function extractTag(tokens, s, opts) {
  // Check if the tag is a closer or an opener.
  let l = tokens.length, i = s, startToken = tokens[s]

  let tagType = l > i + 1 && tokens[i + 1].value == '/' && 'closer' || null
  tagType == 'closer' && i++

  let attrs = new AttrList()

  // Extract the tag name.
  let tagName = l > i + 1 && tokens[++i]
  if (!tagName) {
    throw `tag name missing for row: ${startToken.start.row}, col: ${startToken.start.col}`
  }
  ++i

  for (; i < l; ++i) {
    let token = tokens[i]

    if (token.value == '>') {
      // End of tag.
      break
    } else if (token.value != '/') {
      // Should be an attribute or an Opener.
      if (isOpener(token.value)) {
        // Find its end.
        let e = findBracketEnd(tokens, i)
        if (e == -1) {
          throw `could not find end of opener at row: ${token.start.row}, col: ${token.start.col}`
        }
        i = e
      } else {
        // The attribute name ends when a '=' is encountered.
        let k = i
        let nameTokens = [], valueTokens = [], eqToken
        for (; k < l; ++k) {
          if (tokens[k].value == '=') {
            break
          }
          nameTokens.push(tokens[k])
        }

        if (k >= l) {
          throw `could not find attribute value (row: ${token.start.row}, col: ${token.start.col})`
        }

        // Combine the name tokens to get the attribute name.
        let attrName
        if (opts instanceof Object && typeof opts.str === 'string') {
          attrName = opts.str.substring(nameTokens.at(0).start.index, nameTokens.at(-1).end.index)
        } else {
          attrName = nameTokens.reduce((o, t) => o + t.value, '')
        }

        // Extract the attribute value.
        // If the immediate value after '=' is an opener, then 
        // find the corresponding closer, and store the container
        // as the value.
        if (l == k + 1) {
          let t = tokens[k]
          throw `expected value after '=' at row: ${t.start.row}, col: ${t.start.col}`
        }

        eqToken = tokens[k++]

        if (isOpener(tokens[k].value)) {
          // Search for the end of the container.
          let e = findBracketEnd(tokens, k)
          if (e == -1) {
            let t = tokens[k]
            throw `could not find end of opener at row: ${t.start.row}, col: ${t.start.col}`
          }
          for (; k <= e; ++k) { valueTokens.push(tokens[k]) }
          i = e
        } else {
          valueTokens.push(tokens[k])
          i = k
        }


        let attrValue
        if (opts instanceof Object && typeof opts.str === 'string') {
          attrValue = opts.str.substring(valueTokens.at(0).start.index, valueTokens.at(-1).end.index)
        } else {
          attrValue = valueTokens.reduce((o, t) => o + t.value, '')
        }

        attrs.add({ name: attrName, value: attrValue, nameTokens, eqToken, valueTokens })
      }
    }
  }

  if (i >= l) {
    throw `failed to find end of tag starting at row: ${startToken.start.row}, col: ${startToken.start.col}`
  }
  let endToken = tokens[i]

  // Check if the second last token i.e the token 
  // before '>' is '/'. If so, then the tag is 
  // a hybrid tag. In other words the tag does not 
  // have a closer.
  if (tokens[i - 1].value == '/') {
    if (tagType) {
      throw `tag at row: ${startToken.start.row}, col: ${startToken.start.col} cannot be a ${tagType} tag and hybrid tag at the same time`
    }
    tagType = 'hybrid'
  }

  return {
    tagName: tagName,
    attrs: attrs,
    start: { token: startToken, index: s },
    end: { token: endToken, index: i },
    tagType: tagType || 'opener',
  }
}


function extractBody(tokens, s, fn, opts) {
  let childNodes = []

  let i = s, l = tokens.length

  for (; i < l; ++i) {
    if (fn(tokens, i)) {
      break
    } else if (tokens[i].value == '<') {
      let el = extractElement(tokens, i, null, opts)

      if (OPENER_ONLY_TAGS.find(t => t === el.tagName)) {
        i = el.openerTag.end.index
      } else {
        i = el.closerTag.end.index
      }
      
      childNodes.push(el)
    } else {
      if (isOpener(tokens[i].value)) {
        let e = findBracketEnd(tokens, i)
        if (e != -1) {
          childNodes.push(Object.assign(new PreNode(), {
            nodeType: 'block',
            tokens: tokens.slice(i, e+1),
            value: opts.str.substring(tokens[i].start.index, tokens[e].end.index),
          }))
          i = e
          continue
        }
      } 

      if (!childNodes.length || childNodes.at(-1).nodeType !== 'text') {
        childNodes.push(Object.assign(new PreNode(), {
          nodeType: 'text',
          tokens: [tokens[i]],
          value: tokens[i].value
        }))
      } else {
        let t = childNodes.at(-1)
        t.tokens.push(tokens[i])
        t.value = opts.str.substring(t.tokens.at(0).start.index, tokens[i].end.index)
      }
    }
  }

  return [i, childNodes]
}

// Extracts an HTML DOM Element.
function extractElement(tokens, s, tag, opts) {
  // Extract the Opener Tag.
  let openerTag = tag || extractTag(tokens, s, opts), closerTag

  // Criteria for a tag to have a body.
  //    1. The tag name has to be one of the 
  //       HTML specification specified tags that do not have a body.
  //       Example: <img>, <input>, etc.
  //    2. The tag must be a hybrid tag i.e ending with '/>'.
  if (openerTag.tagType == 'hybrid' || OPENER_ONLY_TAGS.find(t => t == openerTag.tagName.value)) {
    return Object.assign(new PreNode(), {
      nodeType: 'element',
      tagName: openerTag.tagName.value,
      openerTag: openerTag,
      closerTag: null,
      childNodes: [],
      value: opts && opts.str.substring(openerTag.start.token.start.index, openerTag.end.token.end.index),
      innerContent: null
    })
  }

  let [e, childNodes] = extractBody(tokens, openerTag.end.index + 1, (tokens, i) => {
    if (tokens[i].value == '<') {
      let t = extractTag(tokens, i)
      return t.tagType === 'closer' && t.tagName.value === openerTag.tagName.value
    }
  }, opts)

  closerTag = e < tokens.length && extractTag(tokens, e, opts) || null

  return Object.assign(new PreNode(), {
    nodeType: 'element',
    tagName: openerTag.tagName.value,
    openerTag: openerTag,
    closerTag: closerTag,
    childNodes: childNodes,
    value: opts && closerTag && opts.str.substring(openerTag.start.token.start.index, closerTag.end.token.end.index),
    innerContent: opts.str.substring(openerTag.end.token.end.index, closerTag.start.token.start.index),
  })
}

function parseHtml5(str) {
  let tokens = tokenize(str)
  let [_, childNodes] = extractBody(tokens, 0, () => false, { str })
  return childNodes
}

export default { AttrList, isOpener, parseHtml5 }
